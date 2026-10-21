// Fake XUI.one server + static host for testing the UI in a desktop browser.
// Run: node dev/mock-server.js  → open http://localhost:8787  (server field: http://localhost:8787, user/pass: test/test)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8787;
const WWW = path.join(__dirname, '..', 'www');
const TEST_HLS = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const TEST_MP4 = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4';
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const now = Math.floor(Date.now() / 1000);

const liveCats = [
  { category_id: '1', category_name: 'Notícias' },
  { category_id: '2', category_name: 'Esportes' },
  { category_id: '3', category_name: 'Filmes 24h' }
];
const live = Array.from({ length: 400 }, (_, i) => ({
  num: i + 1, name: `Canal ${i + 1} ${['News', 'Sport', 'Cine'][i % 3]}`, stream_id: 1000 + i,
  stream_icon: '', category_id: String((i % 3) + 1), epg_channel_id: `c${i}`
}));
const vodCats = [{ category_id: '10', category_name: 'Ação' }, { category_id: '11', category_name: 'Comédia' }];
const vod = Array.from({ length: 60 }, (_, i) => ({
  name: `Filme ${i + 1}`, stream_id: 5000 + i, stream_icon: '', rating: '7.1',
  category_id: i % 2 ? '11' : '10', container_extension: 'mp4'
}));
const seriesCats = [{ category_id: '20', category_name: 'Drama' }];
const series = Array.from({ length: 12 }, (_, i) => ({
  name: `Série ${i + 1}`, series_id: 9000 + i, cover: '', plot: 'Uma série de teste.', genre: 'Drama',
  rating: '8', category_id: '20'
}));

function api(q) {
  if (q.get('username') !== 'test' || q.get('password') !== 'test') return { user_info: { auth: 0 } };
  switch (q.get('action')) {
    case null: case '':
      return {
        user_info: { auth: 1, status: 'Active', exp_date: String(now + 30 * 86400), max_connections: '1' },
        server_info: { url: 'localhost', port: String(PORT), server_protocol: 'http' }
      };
    case 'get_live_categories': return liveCats;
    case 'get_vod_categories': return vodCats;
    case 'get_series_categories': return seriesCats;
    case 'get_live_streams': return live;
    case 'get_vod_streams': return vod;
    case 'get_series': return series;
    case 'get_vod_info': return { info: { plot: 'Sinopse do filme.', genre: 'Ação', duration: '01:45:00' } };
    case 'get_short_epg':
      return {
        epg_listings: [0, 1, 2].map((k) => ({
          title: b64(`Programa ${k + 1} — ação`), description: b64('Descrição do programa.'),
          start_timestamp: String(now + k * 3600 - 1200), stop_timestamp: String(now + (k + 1) * 3600 - 1200)
        }))
      };
    case 'get_series_info':
      return {
        info: { name: `Série ${Number(q.get('series_id')) - 8999}`, plot: 'Uma série de teste.' },
        episodes: Object.fromEntries([1, 2].map((s) => [String(s), Array.from({ length: 6 }, (_, e) => ({
          id: `${s}${e}`, episode_num: e + 1, title: `Episódio ${e + 1}`, container_extension: 'mp4',
          info: { duration: '00:42:00' }
        }))]))
      };
  }
  return [];
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  console.log(req.method, u.pathname + u.search);
  if (u.pathname === '/player_api.php') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(api(u.searchParams)));
  }
  if (/^\/live\//.test(u.pathname)) { res.writeHead(302, { Location: TEST_HLS }); return res.end(); }
  if (/^\/(movie|series)\//.test(u.pathname)) { res.writeHead(302, { Location: TEST_MP4 }); return res.end(); }
  const file = path.join(WWW, u.pathname === '/' ? 'index.html' : path.normalize(u.pathname));
  if (!file.startsWith(WWW) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`mock XUI on http://localhost:${PORT}`));
