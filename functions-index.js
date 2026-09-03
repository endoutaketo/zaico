// functions-index.js
//
// これはFirebase Cloud Functions用のサンプルコードです。ブラウザ（index.html）だけでは
// 「アプリを閉じていても届くプッシュ通知」を自分自身に送ることはできません。
// 実際に送信する処理は、信頼されたサーバー環境（Cloud Functions）で
// Firebase Admin SDK を使って行う必要があります。
//
// ■ セットアップ手順（概要）
//   1. ローカルに Firebase CLI をインストール: npm install -g firebase-tools
//   2. プロジェクトフォルダで: firebase init functions
//      （言語は JavaScript、既存の zaico-4d8b3 プロジェクトを選択）
//   3. 生成された functions/index.js の中身を、このファイルの内容に置き換える
//      （もしくは必要な関数だけコピーする）
//   4. デプロイ: firebase deploy --only functions
//
// ■ このサンプルがやっていること
//   users/{uid} ドキュメントが更新されるたびに、更新前後の products 配列を比較して
//   「新しく発生した」在庫アラート・期限アラートだけを抽出し、
//   settings.pushEnabled が true かつ settings.pushTokens にトークンが
//   登録されているユーザーに対して、該当するトグル（notifyStockOut等）が
//   ONになっている種別のみプッシュ通知を送信します。
//
//   本番運用する場合は、送信済みアラートの記録（例: 同じ商品・種別への通知は
//   1日1回まで、等）や、無効なトークンをpushTokensから取り除く処理などを
//   追加することをおすすめします。

const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const LOT_EXPIRY_SOON_DAYS_DEFAULT = 30;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function productStockStatus(p) {
  const stock = p.stock || 0;
  if (stock <= 0) return "out";
  if (p.lowAlert !== "" && p.lowAlert != null && stock <= Number(p.lowAlert)) return "low";
  if (p.highAlert !== "" && p.highAlert != null && stock >= Number(p.highAlert)) return "high";
  return "ok";
}

function lotExpiryStatus(expiry, soonDays) {
  if (!expiry) return null;
  const today = todayISO();
  if (expiry < today) return "expired";
  const days = soonDays != null ? soonDays : LOT_EXPIRY_SOON_DAYS_DEFAULT;
  const soonDate = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  if (expiry <= soonDate) return "soon";
  return "ok";
}

// index.html の buildStockNotifications と同じロジックで、通知IDの集合を作る。
function buildAlertIds(products, settings) {
  const ids = new Set();
  const notifyOn = (key) => !settings || settings[key] !== false;
  const soonDays = settings && settings.expirySoonDays != null ? Number(settings.expirySoonDays) : LOT_EXPIRY_SOON_DAYS_DEFAULT;
  (products || []).forEach((p) => {
    const status = productStockStatus(p);
    if (status !== "ok") {
      const key = status === "out" ? "notifyStockOut" : status === "low" ? "notifyStockLow" : "notifyStockHigh";
      if (notifyOn(key)) ids.add(`${p.id}:${status}`);
    }
    if (settings && settings.lotExpiry && Array.isArray(p.lots)) {
      p.lots.forEach((l) => {
        if (!((l.qty || 0) > 0)) return;
        const lotStatus = lotExpiryStatus(l.expiry, soonDays);
        if (lotStatus !== "expired" && lotStatus !== "soon") return;
        const key = lotStatus === "expired" ? "notifyExpired" : "notifyExpiringSoon";
        if (notifyOn(key)) ids.add(`${p.id}:lot:${l.id}:${lotStatus}`);
      });
    }
  });
  return ids;
}

function labelFor(id, products) {
  const [productId, kind] = [id.split(":")[0], id.includes(":lot:") ? id.split(":").pop() : id.split(":")[1]];
  const product = (products || []).find((p) => p.id === productId);
  const name = product ? product.name : "商品";
  if (kind === "out") return `${name}が在庫切れです`;
  if (kind === "low") return `${name}の在庫が少なくなっています`;
  if (kind === "high") return `${name}の在庫が上限を超えています`;
  if (kind === "expired") return `${name}の有効期限が切れています`;
  if (kind === "soon") return `${name}の有効期限が近づいています`;
  return `${name}の通知があります`;
}

exports.sendStockAlertPush = functions.firestore
  .document("users/{uid}")
  .onUpdate(async (change) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    const settings = after.settings || {};

    if (!settings.pushEnabled) return null;
    const tokens = Array.isArray(settings.pushTokens) ? settings.pushTokens.filter(Boolean) : [];
    if (tokens.length === 0) return null;

    const beforeIds = buildAlertIds(before.products, before.settings || {});
    const afterIds = buildAlertIds(after.products, settings);

    // 「更新前にはなかったが、更新後に新しく発生した」アラートだけを対象にする
    const newIds = [...afterIds].filter((id) => !beforeIds.has(id));
    if (newIds.length === 0) return null;

    // 通知が多すぎる場合に備えて、1回の送信では先頭5件に要約する
    const shown = newIds.slice(0, 5);
    const title = "在庫管理システム";
    const body = shown.map((id) => labelFor(id, after.products)).join("\n") +
      (newIds.length > shown.length ? `\n他${newIds.length - shown.length}件` : "");

    const message = {
      notification: { title, body },
      tokens,
    };

    const res = await admin.messaging().sendEachForMulticast(message);

    // 無効化された（登録解除済みの）トークンをpushTokensから取り除く
    const invalidTokens = [];
    res.responses.forEach((r, i) => {
      if (!r.success && r.error && (r.error.code === "messaging/registration-token-not-registered" || r.error.code === "messaging/invalid-registration-token")) {
        invalidTokens.push(tokens[i]);
      }
    });
    if (invalidTokens.length > 0) {
      const cleaned = tokens.filter((tk) => !invalidTokens.includes(tk));
      await change.after.ref.set({ settings: { pushTokens: cleaned } }, { merge: true });
    }
    return null;
  });
