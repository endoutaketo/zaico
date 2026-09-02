// ---- 在庫管理 Service Worker ----
// アプリ本体(index.html)とアイコン等をキャッシュし、オフラインでも
// アプリが起動できるようにする。データ通信(Firebase)はキャッシュ対象外で、
// 通信がある場合は常にネットワークを優先する(古いデータでの上書きを防ぐため)。

const CACHE_VERSION = "v1";
const CACHE_NAME = "zaico-shell-" + CACHE_VERSION;

// このsw.jsが置かれているディレクトリを基準にする(GitHub Pagesのサブパス配信に対応)
const SCOPE_URL = self.registration.scope;

const APP_SHELL = [
  "",
  "index.html",
  "manifest.json",
  "icon-192.png",
  "apple-touch-icon.png"
].map(function (path) { return new URL(path, SCOPE_URL).toString(); });

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // 個々のリソースの取得失敗(アイコン未配置など)でinstall全体が失敗しないようにする
      return Promise.all(
        APP_SHELL.map(function (url) {
          return cache.add(url).catch(function (err) {
            console.warn("[SW] キャッシュ失敗(無視して続行):", url, err);
          });
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) {
          return key.indexOf("zaico-shell-") === 0 && key !== CACHE_NAME;
        }).map(function (key) {
          return caches.delete(key);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;

  // GET以外(POST等)やFirebase/外部API/CDNへの通信はSWを介さず、そのままネットワークへ。
  // (認証・データ保存はオンライン専用、またはFirestore SDK自身のオフラインキャッシュに任せる)
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isAppShellPath = isSameOrigin && APP_SHELL.some(function (shellUrl) {
    return new URL(shellUrl).pathname === url.pathname;
  });

  if (!isAppShellPath) {
    // firebaseapp.com / firestore.googleapis.com / CDN(sheetjs, jsdelivr, unpkg等)はキャッシュしない。
    // ネットワーク優先、失敗時は何もしない(ブラウザの通常のエラー処理に任せる)。
    return;
  }

  // アプリ本体はネットワーク優先。オンラインなら常に最新版を取得してキャッシュを更新し、
  // オフライン(通信失敗)時のみキャッシュから返す。
  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(req, resClone);
        });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (cached) {
        if (cached) return cached;
        // index.html自体がキャッシュに無い場合のための最終フォールバック
        if (req.mode === "navigate") {
          return caches.match(new URL("index.html", SCOPE_URL).toString());
        }
        return Response.error();
      });
    })
  );
});
