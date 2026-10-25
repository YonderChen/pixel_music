/* Renderer for the small SVG vocabulary emitted by MusicArtCore. It never loads
 * arbitrary SVG, URLs, scripts or CSS; imported MIDI/JSON is normalized by the core.
 * Reuses the exact generated paths, palettes, clipping and paper pattern. */
'use strict';
function attrs(tag) { const a = {}; tag.replace(/([\w-]+)="([^"]*)"/g, (_, key, value) => { a[key] = value; return ''; }); return a; }
function path(context, d) {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/g) || [];
  let i = 0, command, x = 0, y = 0, sx = 0, sy = 0;
  context.beginPath();
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i])) command = tokens[i++];
    const relative = command === command.toLowerCase(), type = command.toUpperCase(), baseX = relative ? x : 0, baseY = relative ? y : 0;
    const n = () => { const v = Number(tokens[i++]); if (!Number.isFinite(v)) throw new Error('画作路径无效'); return v; };
    if (type === 'Z') { context.closePath(); x = sx; y = sy; command = null; continue; }
    if (type === 'M' || type === 'L') { x = n() + baseX; y = n() + baseY; if (type === 'M') { context.moveTo(x, y); sx = x; sy = y; command = relative ? 'l' : 'L'; } else context.lineTo(x, y); }
    else if (type === 'H') { x = n() + baseX; context.lineTo(x, y); }
    else if (type === 'V') { y = n() + baseY; context.lineTo(x, y); }
    else if (type === 'C') { const x1 = n() + baseX, y1 = n() + baseY, x2 = n() + baseX, y2 = n() + baseY; x = n() + baseX; y = n() + baseY; context.bezierCurveTo(x1,y1,x2,y2,x,y); }
    else if (type === 'Q') { const x1 = n() + baseX, y1 = n() + baseY; x = n() + baseX; y = n() + baseY; context.quadraticCurveTo(x1,y1,x,y); }
    else throw new Error('不支持的画作路径 ' + type);
  }
}
function transform(c, value) {
  (value || '').replace(/(translate|rotate)\(([^)]+)\)/g, (_, name, values) => {
    const n = values.trim().split(/[ ,]+/).map(Number);
    if (name === 'translate') c.translate(n[0], n[1] || 0);
    else { if (n.length > 1) c.translate(n[1], n[2]); c.rotate(n[0] * Math.PI / 180); if (n.length > 1) c.translate(-n[1], -n[2]); }
    return '';
  });
}
function rect(c, x, y, w, h, r) {
  r = Math.min(r || 0, w / 2, h / 2); c.beginPath(); c.moveTo(x+r,y); c.lineTo(x+w-r,y); c.quadraticCurveTo(x+w,y,x+w,y+r); c.lineTo(x+w,y+h-r); c.quadraticCurveTo(x+w,y+h,x+w-r,y+h); c.lineTo(x+r,y+h); c.quadraticCurveTo(x,y+h,x,y+h-r); c.lineTo(x,y+r); c.quadraticCurveTo(x,y,x+r,y); c.closePath();
}
function paint(c, a, inherited) {
  const style = Object.assign({}, inherited, a), fill = style.fill || '#000';
  c.lineWidth = Number(style['stroke-width'] || 1); c.lineCap = style['stroke-linecap'] || 'butt'; c.lineJoin = style['stroke-linejoin'] || 'miter'; c.setLineDash((style['stroke-dasharray'] || '').split(/[ ,]+/).filter(Boolean).map(Number));
  if (fill !== 'none') { c.fillStyle = fill; c.globalAlpha = Number(style['fill-opacity'] || 1); c.fill(); }
  if (style.stroke && style.stroke !== 'none') { c.strokeStyle = style.stroke; c.globalAlpha = Number(style['stroke-opacity'] || 1); c.stroke(); }
  c.globalAlpha = 1;
}
function draw(c, svg, width, height, viewWidth = 1200, viewHeight = 900) {
  c.save(); c.scale(width / viewWidth, height / viewHeight);
  const paperInk = (svg.match(/<pattern[^>]*id="paper"[\s\S]*?stroke="([^"]+)"/) || [,'#334d49'])[1];
  const clean = svg.replace(/<defs>[\s\S]*?<\/defs>/g, '').replace(/<(title|desc)\b[^>]*>[\s\S]*?<\/\1>/g, '');
  const tokens = clean.match(/<[^>]+>|[^<]+/g) || [], stack = [{}];
  for (let i = 0; i < tokens.length; i++) {
    const tag = tokens[i]; if (!tag.startsWith('<')) continue;
    if (/^<\/g/.test(tag)) { c.restore(); stack.pop(); continue; }
    const name = (tag.match(/^<([\w]+)/) || [])[1]; if (!name || name === 'svg') continue;
    const a = attrs(tag), inherited = stack[stack.length - 1];
    if (name === 'g') {
      c.save(); transform(c,a.transform);
      if (a['clip-path'] === 'url(#artBounds)') { rect(c,76,70,1048,760,2); c.clip(); }
      stack.push(Object.assign({},inherited,a)); continue;
    }
    c.save(); transform(c,a.transform);
    const n = key => Number(a[key] || 0);
    if (a.fill === 'url(#paper)') {
      c.strokeStyle = paperInk; c.globalAlpha = .055; c.lineWidth = .6; c.beginPath();
      for (let y=0;y<900;y+=9) for(let x=0;x<1200;x+=9) { c.moveTo(x+1,y+2); c.lineTo(x+1.7,y+2); c.moveTo(x+6,y+6); c.lineTo(x+6.6,y+6); } c.stroke(); c.restore(); continue;
    }
    if (name === 'path') path(c,a.d || '');
    else if (name === 'rect') rect(c,n('x'),n('y'),n('width'),n('height'),n('rx'));
    else if (name === 'circle' || name === 'ellipse') { c.beginPath(); c.ellipse(n('cx'),n('cy'),n(name==='circle'?'r':'rx'),n(name==='circle'?'r':'ry'),0,0,Math.PI*2); }
    else if (name === 'text') { c.font = (a['font-weight'] || '400') + ' ' + (a['font-size'] || 13) + 'px sans-serif'; c.textAlign = a['text-anchor'] === 'end' ? 'right' : 'left'; c.fillStyle = a.fill || inherited.fill || '#334d49'; c.globalAlpha = Number(a['fill-opacity'] || 1); c.fillText((tokens[i+1] || '').replace(/&amp;/g,'&'),n('x'),n('y')); c.restore(); continue; }
    else { c.restore(); continue; }
    paint(c,a,inherited); c.restore();
  }
  c.restore();
}
module.exports = {draw, path};
