const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const MEDIA = path.join(__dirname, '..', '..', 'media')
const read = name => fs.readFileSync(path.join(MEDIA, name), 'utf8')

function panelHtml() {
  const nonce = crypto.randomBytes(12).toString('hex')
  return read('panel.html')
    .replace('{{css}}', () => read('panel.css'))
    .replace('{{script}}', () => read('panel.js'))
    .replace(/\{\{nonce\}\}/g, nonce)
}

module.exports = { panelHtml }
