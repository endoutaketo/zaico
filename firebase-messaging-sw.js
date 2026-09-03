// firebase-messaging-sw.js
// アプリを閉じている／タブが非表示の間に届いたプッシュ通知をOSの通知として表示するための
// サービスワーカーです。index.html と同じ階層（サイトのルート）に配置してください。
//
// 注意: これは index.html が既に登録している sw.js とは別のファイルです。
// もし既存の sw.js の中でオフラインキャッシュ等を行っている場合、この内容を
// そちらにマージしても構いません（その場合は index.html 側の
// requestPushToken() 内の navigator.serviceWorker.register("firebase-messaging-sw.js")
// を、マージ先のファイル名に書き換えてください）。

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

// index.html の window.__kpFirebaseConfig と同じ値を設定してください。
firebase.initializeApp({
  apiKey: "AIzaSyAXuIXAtXBOQd0npSJwyzQmqgX3CL-fIeo",
  authDomain: "zaico-4d8b3.firebaseapp.com",
  projectId: "zaico-4d8b3",
  storageBucket: "zaico-4d8b3.firebasestorage.app",
  messagingSenderId: "936272523565",
  appId: "1:936272523565:web:63a370036e0c6e6b4d23a4",
});

const messaging = firebase.messaging();

// アプリが閉じている／バックグラウンドの時に届いたプッシュを、OSの通知として表示する。
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || "在庫管理";
  const body = (payload.notification && payload.notification.body) || (payload.data && payload.data.body) || "";
  self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png", // お使いのアイコンファイルのパスに合わせて変更してください
    data: (payload.data && payload.data.url) ? { url: payload.data.url } : undefined,
  });
});

// 通知をタップしたらアプリを開く（既に開いているタブがあればそこにフォーカス）。
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
