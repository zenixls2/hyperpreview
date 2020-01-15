const {getStringCellWidth} = require('./charwidth');

const protocolClause = '(https?:\\/\\/)';
const domainCharacterSet = '[\\da-z\\.-]+';
const domainBodyClause = '(' + domainCharacterSet + ')';
const tldClause = '([a-z\\.]{2,6})';
const ipClause = '((\\d{1,3}\\.){3}\\d{1,3})';
const localHostClause = '(localhost)';
const portClause = '(:\\d{1,5})';
const hostClause =
  '((' + domainBodyClause + '\\.' + tldClause + ')|' + ipClause + '|' + localHostClause + ')' + portClause + '?';
const pathCharacterSet = '(\\/[\\/\\w\\.\\-%~:+]*)*([^:"\'\\s])';
const pathClause = '(' + pathCharacterSet + ')?';
const queryStringHashFragmentCharacterSet = "[0-9\\w\\[\\]\\(\\)\\/\\?\\!#@$%&'*+,:;~\\=\\.\\-]*";
const queryStringClause = '(\\?' + queryStringHashFragmentCharacterSet + ')?';
const hashFragmentClause = '(#' + queryStringHashFragmentCharacterSet + ')?';
const bodyClause = hostClause + pathClause + queryStringClause + hashFragmentClause;
const regex = new RegExp(protocolClause + bodyClause, 'g');

var callback = {};
var currentUid = null;
exports.middleware = () => next => action => {
  // Just to trigger refresh/rescan when there's any output from terminal
  if (action.type === 'SESSION_ADD_DATA') {
    if (currentUid && callback[currentUid]) {
      callback[currentUid]();
    }
  } else if (action.type === 'SESSION_SET_ACTIVE' || action.type === 'SESSION_ADD') {
    currentUid = action.uid;
    if (currentUid && callback[currentUid]) {
      callback[currentUid]();
    }
  } else if (action.type === 'SESSION_PTY_EXIT') {
    delete callback[action.uid];
  }
  next(action);
};

exports.decorateTerm = (Term, {React}) => {
  return class extends React.Component {
    constructor(props, context) {
      super(props, context);
      this._onDecorated = this._onDecorated.bind(this);
      this._onMouseMove = this._onMouseMove.bind(this);
      this._onChange = this._onChange.bind(this);
      this.embed = null;
      this.term = null;
      this.ctx = null;
      this.canvas = null;
      this.dataInView = '';
      this.collected = [];
    }
    componentDidMount() {
      let embed = this.embed;
      embed.addEventListener('load-commit', () => {
        embed.setZoomFactor(0.3);
        embed.insertCSS('html,body{ overflow: hidden !important;}');
      });
      callback[this.props.uid] = this._onChange;
    }
    _onChange() {
      if (this.term) {
        const {buffer, rows, cols} = this.term;
        let collected = [];
        if (this.canvas) {
          this.canvas.removeEventListener('mousemove', this._onMouseMove, false);
        }
        let screen = this.term.screenElement;
        lb: {
          for (let canvas of screen.childNodes) {
            for (let cls of canvas.classList) {
              if (cls === 'xterm-cursor-layer') {
                this.canvas = canvas;
                break lb;
              }
            }
          }
        }
        if (this.canvas.getContext) {
          this.ctx = this.canvas.getContext('2d');
          this.ctx.font = '' + this.props.fontSize + 'px ' + this.props.fontFamily;
          this.ctx.fillStyle = this.props.foregroundColor;
        } else {
          return;
        }
        this.canvas.addEventListener('mousemove', this._onMouseMove, false);
        const iterator = buffer.iterator(false, buffer.ydisp, rows + 1);
        while (iterator.hasNext()) {
          const lineData = iterator.next();
          let line = lineData.content;
          let match = null;
          let stringIndex = -1;
          let rowIndex = lineData.range.first;
          while ((match = regex.exec(line))) {
            let uri = match[0];
            stringIndex = line.indexOf(uri, stringIndex + 1);
            regex.lastIndex = stringIndex + uri.length;
            let bufferIndex = buffer.stringIndexToBufferIndex(rowIndex, stringIndex);
            let x = bufferIndex[1];
            let y = bufferIndex[0] - buffer.ydisp;
            let width = getStringCellWidth(uri);
            let x1 = x % cols;
            let y1 = y + Math.floor(x / cols);
            let x2 = (x1 + width) % cols;
            let y2 = y1 + Math.floor((x1 + width) / cols);
            if (x2 === 0) {
              x2 = cols;
              y2--;
            }
            collected.push({
              x1: x1,
              x2: x2,
              y1: y1 + 1,
              y2: y2 + 1,
              data: uri
            });
          }
        }
        this.collected = collected;
        //if (collected.length) console.log(collected);
      }
    }
    _onMouseMove(ev) {
      if (!this.embed) return;
      let embed = this.embed;
      if (this.term === null) {
        embed.style.display = 'none';
        //embed.src = "";
        return;
      }
      const {mouseHelper, screenElement, charMeasure, cols, rows} = this.term;
      const coords = mouseHelper.getCoords(ev, screenElement, charMeasure, cols, rows);
      if (!coords) {
        embed.style.display = 'none';
        //embed.src = ""
        return;
      }
      const x = coords[0];
      const y = coords[1];
      const height = this.term.viewport._charMeasure.height;
      const width = this.term.viewport._charMeasure.width;
      for (let item of this.collected) {
        if (item.y1 === item.y2) {
          // Single line link
          if (item.y1 === y && x >= item.x1 && x <= item.x2) {
            if (this.dataInView !== item.data) {
              this.dataInView = item.data;
              embed.src = item.data;
            }
            embed.style.display = 'block';
            embed.style.left = item.x2 * width + 'px';
            embed.style.top = item.y2 * height + 'px';
            return;
          }
        } else {
          // Multi-line link
          if ((y == item.y1 && x >= item.x1) || (y == item.y2 && x <= item.x2) || (y > item.y1 && y < item.y2)) {
            if (this.dataInView !== item.data) {
              this.dataInView = item.data;
              embed.src = item.data;
            }
            embed.style.display = 'block';
            embed.style.left = item.x2 * width + 'px';
            embed.style.top = item.y2 * height + 'px';
            return;
          }
        }
      }
      embed.style.display = 'none';
      //embed.src = "";
    }
    _onDecorated(term) {
      if (this.props.onDecorated) this.props.onDecorated(term);
      if (term && term.term && term.term._core) {
        this.term = term.term._core;
        this.term.viewport._viewportElement.addEventListener(
          'scroll',
          () => {
            if (callback[this.props.uid]) callback[this.props.uid]();
          },
          false
        );
      }
    }
    render() {
      const style = Object.assign({}, this.props.style || {}, {height: '100%'});
      return React.createElement(
        'div',
        {style},
        React.createElement('webview', {
          name: 'preview-disable-x-frame-options',
          src: this.dataInView,
          ref: input => {
            this.embed = input;
          },
          style: {
            borderRadius: '3px',
            width: '200px',
            height: '200px',
            position: 'absolute',
            overflow: 'hidden',
            border: '1px sold back',
            zIndex: 4,
            display: 'none'
          }
        }),
        React.createElement(
          Term,
          Object.assign({}, this.props, {
            onDecorated: this._onDecorated
          })
        )
      );
    }
  };
};
