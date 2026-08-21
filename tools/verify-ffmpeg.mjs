// 最小宿主端验证：mock webServer.register，检查 ffmpeg 三路由的行为
// 用法：node tools/verify-ffmpeg.mjs  （可先 PATH=/nonexistent 跑一次测 found:false）
import { apply } from '../lib/index.js';

const routes = [];
const ctx = { webServer: { register: (r) => routes.push(r) } };
apply(ctx);

function makeRes() {
  return {
    statusCode: 0, headers: null, body: null,
    writeHead(c, h) { this.statusCode = c; this.headers = h; },
    end(b) { this.body = b === undefined ? '' : String(b); },
  };
}
function call(route, url, method = 'GET') {
  const res = makeRes();
  const ret = route.handler({ method, url, headers: {} }, res);
  return { res, ret };
}

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : ''));
  if (!cond) failures++;
};

const rCheck = routes.find((r) => r.path === '/api/mpkg-wallpaper/ffmpeg-check');
const rDownload = routes.find((r) => r.path === '/api/mpkg-wallpaper/ffmpeg-download');
const rProgress = routes.find((r) => r.path === '/api/mpkg-wallpaper/transcode-progress');
const rTranscode = routes.find((r) => r.kind === 'prefix' && r.path === '/api/mpkg-wallpaper/transcode');

check('route ffmpeg-check registered', !!rCheck);
check('route ffmpeg-download registered', !!rDownload);
check('route transcode-progress registered', !!rProgress);
check('route transcode (prefix) registered', !!rTranscode);

// 1) ffmpeg-check：不得抛错；found 取决于环境（PATH 探测）
{
  const { res } = call(rCheck, '/api/mpkg-wallpaper/ffmpeg-check');
  const body = JSON.parse(res.body || '{}');
  check('ffmpeg-check 200 + ok:true', res.statusCode === 200 && body.ok === true, JSON.stringify(body));
  check('ffmpeg-check has found/path/version fields', 'found' in body && 'path' in body && 'version' in body);
}

// 2) ffmpeg-download：非 POST → 405
{
  const { res } = call(rDownload, '/api/mpkg-wallpaper/ffmpeg-download');
  check('ffmpeg-download GET → 405', res.statusCode === 405, 'status=' + res.statusCode);
}

// 3) transcode-progress：无任务 → idle，不抛错
{
  const { res } = call(rProgress, '/api/mpkg-wallpaper/transcode-progress');
  const body = JSON.parse(res.body || '{}');
  check('transcode-progress → idle', res.statusCode === 200 && body.phase === 'idle', JSON.stringify(body));
}

// 4) transcode：fps 非法 → 400
{
  const { res } = call(rTranscode, '/api/mpkg-wallpaper/transcode?fps=999');
  const body = JSON.parse(res.body || '{}');
  check('transcode invalid fps → 400 ok:false', res.statusCode === 400 && body.ok === false, JSON.stringify(body));
}

// 5) transcode：合法 fps 但未知源 → 404（不抛错、不触发转码）
{
  const { res } = call(rTranscode, '/api/mpkg-wallpaper/transcode/unknown-token-123?fps=60');
  const body = JSON.parse(res.body || '{}');
  check('transcode unknown source → 404 ok:false', res.statusCode === 404 && body.ok === false, JSON.stringify(body));
}

// 6) transcode：/transcode/progress 兜底子路径 → 返回进度 JSON 而非 404
{
  const { res } = call(rTranscode, '/api/mpkg-wallpaper/transcode/progress');
  const body = JSON.parse(res.body || '{}');
  check('transcode/progress fallback → phase', res.statusCode === 200 && typeof body.phase === 'string', JSON.stringify(body));
}

console.log(failures === 0 ? '\nALL PASS' : '\n' + failures + ' FAILURE(S)');
process.exit(failures === 0 ? 0 : 1);
