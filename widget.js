// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: calendar-alt;

// ============================================================
// 自作カレンダーのウィジェット（iPhoneのアプリ「Scriptable」用）
// GitHubの非公開リポジトリ（同期先）から予定を読み込んで表示する
// ============================================================

const OWNER = "udon-st";          // GitHubのユーザー名
const REPO = "calendar-data";     // 同期先のリポジトリ
const FILE = "data.json";
const APP_URL = "https://udon-st.github.io/calender/"; // ウィジェットを押したときに開く
const TOKEN_KEY = "calendar-sync-token";               // トークンの保存先（iPhoneのキーチェーン）
const CACHE_NAME = "calendar-widget-cache.json";        // 通信できないとき用の控え
const DAYS_AHEAD = 14;                                  // 何日先まで探すか
const WD = ["日", "月", "火", "水", "木", "金", "土"];

// ===== 予定の計算（アプリと同じ計算） =====
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function parseYmd(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
const dayNum = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const daysBetween = (a, b) => dayNum(b) - dayNum(a);
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }

function occurrenceIndex(e, date) {
  const r = e.repeat;
  if (!r) return date === e.date ? 0 : -1;
  if (date < e.date) return -1;
  if (r.endType === "until" && r.until && date > r.until) return -1;
  const iv = Math.max(1, r.interval || 1);
  const a = parseYmd(e.date), b = parseYmd(date);
  let k = -1;
  if (r.freq === "daily") {
    const n = daysBetween(e.date, date);
    if (n % iv === 0) k = n / iv;
  } else if (r.freq === "weekly") {
    const n = daysBetween(e.date, date);
    if (n % (7 * iv) === 0) k = n / (7 * iv);
  } else if (r.freq === "monthly") {
    const n = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    if (b.getDate() === a.getDate() && n % iv === 0) {
      k = n / iv;
      if (a.getDate() > 28) {
        k = 0;
        for (let m = iv; m < n; m += iv) {
          const y = a.getFullYear() + Math.floor((a.getMonth() + m) / 12);
          const mo = (a.getMonth() + m) % 12;
          if (new Date(y, mo + 1, 0).getDate() >= a.getDate()) k++;
        }
        if (n > 0) k++;
      }
    }
  } else if (r.freq === "yearly") {
    const n = b.getFullYear() - a.getFullYear();
    if (b.getMonth() === a.getMonth() && b.getDate() === a.getDate() && n % iv === 0) k = n / iv;
  }
  if (k < 0) return -1;
  if (r.endType === "count" && k >= (r.count || 1)) return -1;
  return k;
}
function occursOn(e, date) {
  if (occurrenceIndex(e, date) < 0) return false;
  return !(e.exdates || []).includes(date);
}
function spanDays(e) {
  if (!e.endDate || e.endDate <= e.date) return 0;
  return Math.min(60, daysBetween(e.date, e.endDate));
}
function eventsOn(events, date) {
  const list = [];
  for (const e of events) {
    const span = spanDays(e);
    for (let k = 0; k <= span; k++) {
      const startDay = k ? addDays(date, -k) : date;
      let inst = null;
      if (!e.repeat) {
        if (e.date === startDay) inst = e;
      } else if (occursOn(e, startDay)) {
        inst = { ...e, date: startDay, endDate: addDays(startDay, span) };
      }
      if (!inst) continue;
      const pos = span === 0 ? "single" : k === 0 ? "first" : k === span ? "last" : "middle";
      list.push({ ...inst, onDate: date, pos });
    }
  }
  const rank = (e) => (e.pos === "middle" || e.pos === "last") ? 0 : e.start ? 2 : 1;
  return list.sort((a, b) => rank(a) - rank(b) || (a.start || "").localeCompare(b.start || ""));
}
// 表に出す時間の文字
function timeText(e) {
  if (e.pos === "middle") return "続き";
  if (e.pos === "last") return e.end ? `〜${e.end}` : "続き";
  return e.start || "終日";
}
// 今日のうち、もう終わった予定かどうか
function isOver(e, now) {
  if (!e.start || e.pos === "first" || e.pos === "middle") return false;
  const [h, m] = (e.end || e.start).split(":").map(Number);
  const end = new Date(now); end.setHours(h, m + (e.end ? 0 : 60), 0, 0);
  return end < now;
}
// 今日から順に、表示する予定を集める（日ごとにまとめる）
function upcoming(events, now, maxLines) {
  const days = [];
  let lines = 0;
  const today = ymd(now);
  for (let i = 0; i <= DAYS_AHEAD && lines < maxLines; i++) {
    const ds = addDays(today, i);
    let evs = eventsOn(events, ds);
    if (i === 0) evs = evs.filter((e) => !isOver(e, now));
    if (!evs.length) continue;
    const room = maxLines - lines - 1; // 日付の見出しの分
    if (room <= 0) break;
    days.push({ date: ds, evs: evs.slice(0, room), more: Math.max(0, evs.length - room) });
    lines += 1 + Math.min(evs.length, room);
  }
  return days;
}
// ===== ここまで（予定の計算） =====

function colorHex(v) {
  if (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  const legacy = { blue: "#3a72d8", red: "#e5484d", orange: "#e8822e", green: "#2f9e6a", purple: "#8e4ec6", gray: "#7d7d7d" };
  return legacy[v] || "#3f72b5";
}
function isLight(hex) {
  const h = colorHex(hex);
  const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 235;
}
function dayLabel(ds, today) {
  const d = parseYmd(ds);
  const base = `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`;
  const diff = daysBetween(today, ds);
  return diff === 0 ? `今日 ${base}` : diff === 1 ? `明日 ${base}` : base;
}

// ===== GitHubから読み込む =====
async function fetchData(token) {
  const req = new Request(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`);
  req.headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.raw+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  req.timeoutInterval = 15;
  const text = await req.loadString();
  const code = req.response && req.response.statusCode;
  if (code === 401) throw new Error("トークンが正しくないか、期限切れです");
  if (code === 404) throw new Error("同期先が見つかりません");
  if (code && code >= 400) throw new Error(`読み込みエラー（${code}）`);
  const data = JSON.parse(text);
  return Array.isArray(data.events) ? data.events : [];
}
const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), CACHE_NAME);
function saveCache(events) { fm.writeString(cachePath, JSON.stringify({ savedAt: Date.now(), events })); }
function loadCache() {
  if (!fm.fileExists(cachePath)) return null;
  try { return JSON.parse(fm.readString(cachePath)); } catch (e) { return null; }
}

async function askToken() {
  const a = new Alert();
  a.title = "トークン";
  a.message = "カレンダーの同期で使っている github_pat_… を貼り付けてください";
  a.addSecureTextField("github_pat_...", "");
  a.addAction("保存");
  a.addCancelAction("キャンセル");
  if ((await a.presentAlert()) === -1) return null;
  const t = a.textFieldValue(0).trim();
  if (t) Keychain.set(TOKEN_KEY, t);
  return t || null;
}

// ===== ウィジェットを作る =====
const FG = Color.dynamic(new Color("#1f1f1f"), new Color("#eeeeee"));
const SUB = Color.dynamic(new Color("#8a8a8a"), new Color("#9a9a9a"));
const BG = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e"));
const RED = Color.dynamic(new Color("#e5484d"), new Color("#ff6369"));
const BLUE = Color.dynamic(new Color("#3a72d8"), new Color("#6c9cf0"));

function build(family, events, note) {
  const now = new Date();
  const today = ymd(now);
  const w = new ListWidget();
  w.backgroundColor = BG;
  w.url = APP_URL;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  const small = family === "small";
  w.setPadding(small ? 12 : 14, small ? 12 : 16, small ? 10 : 12, small ? 12 : 16);

  // 見出し：今日の日付
  const head = w.addStack();
  head.centerAlignContent();
  const d = now;
  const dayNo = head.addText(String(d.getDate()));
  dayNo.font = Font.boldSystemFont(small ? 26 : 22);
  dayNo.textColor = d.getDay() === 0 ? RED : d.getDay() === 6 ? BLUE : FG;
  head.addSpacer(6);
  const sub = head.addText(`${d.getMonth() + 1}月 ${WD[d.getDay()]}曜日`);
  sub.font = Font.mediumSystemFont(small ? 11 : 13);
  sub.textColor = SUB;
  head.addSpacer();
  w.addSpacer(small ? 4 : 6);

  if (!events) {
    const t = w.addText(note || "読み込めませんでした");
    t.font = Font.systemFont(12);
    t.textColor = SUB;
    w.addSpacer();
    return w;
  }

  const maxLines = small ? 5 : family === "large" ? 15 : 6;
  const days = upcoming(events, now, maxLines);
  if (!days.length) {
    const t = w.addText(`${DAYS_AHEAD}日先まで予定はありません`);
    t.font = Font.systemFont(12);
    t.textColor = SUB;
  }
  const fs = small ? 11 : 13;
  for (const day of days) {
    if (!(small && day.date === today && days[0] === day)) {
      const h = w.addText(dayLabel(day.date, today));
      h.font = Font.semiboldSystemFont(small ? 10 : 11);
      h.textColor = SUB;
      w.addSpacer(1);
    }
    for (const e of day.evs) {
      const row = w.addStack();
      row.centerAlignContent();
      const bar = row.addStack();
      bar.size = new Size(3, fs + 2);
      bar.cornerRadius = 1.5;
      const light = isLight(e.color);
      bar.backgroundColor = light ? new Color("#c8c8c8") : new Color(colorHex(e.color));
      row.addSpacer(5);
      if (!small || e.start) {
        const tt = row.addText(timeText(e));
        tt.font = Font.mediumMonospacedSystemFont(fs - 1);
        tt.textColor = SUB;
        tt.lineLimit = 1;
        row.addSpacer(5);
      }
      const ti = row.addText(e.title || "（無題）");
      ti.font = Font.systemFont(fs);
      ti.textColor = light ? SUB : FG;
      ti.lineLimit = 1;
      row.addSpacer();
      w.addSpacer(small ? 2 : 3);
    }
    if (day.more) {
      const m = w.addText(`ほか${day.more}件`);
      m.font = Font.systemFont(10);
      m.textColor = SUB;
    }
    w.addSpacer(small ? 3 : 4);
  }
  w.addSpacer();
  if (note) {
    const n = w.addText(note);
    n.font = Font.systemFont(9);
    n.textColor = SUB;
  }
  return w;
}

// ===== 実行 =====
async function run() {
  let token = Keychain.contains(TOKEN_KEY) ? Keychain.get(TOKEN_KEY) : null;

  // Scriptableのアプリで開いたとき：トークンの設定と、見た目の確認
  let family = config.widgetFamily || "medium";
  if (config.runsInApp) {
    const menu = new Alert();
    menu.title = "カレンダーのウィジェット";
    menu.addAction("プレビュー（小）");
    menu.addAction("プレビュー（中）");
    menu.addAction("プレビュー（大）");
    menu.addAction(token ? "トークンを入れ直す" : "トークンを入れる");
    menu.addCancelAction("閉じる");
    const i = await menu.presentSheet();
    if (i === -1) return;
    if (i === 3) { token = await askToken(); if (!token) return; family = "medium"; }
    else family = ["small", "medium", "large"][i];
    if (!token) token = await askToken();
  }

  let events = null, note = "";
  if (!token) {
    note = "Scriptableでこのスクリプトを開いて、トークンを入れてください";
  } else {
    try {
      events = await fetchData(token);
      saveCache(events);
    } catch (e) {
      const c = loadCache();
      if (c) {
        events = c.events;
        const t = new Date(c.savedAt);
        note = `前回の内容（${t.getMonth() + 1}/${t.getDate()} ${pad(t.getHours())}:${pad(t.getMinutes())}）`;
      } else {
        note = e.message || "読み込めませんでした";
      }
    }
  }

  const w = build(family, events, note);
  if (config.runsInWidget) {
    Script.setWidget(w);
  } else if (family === "small") {
    await w.presentSmall();
  } else if (family === "large") {
    await w.presentLarge();
  } else {
    await w.presentMedium();
  }
}

await run();
Script.complete();
