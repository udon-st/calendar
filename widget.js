// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: calendar-alt;

// ============================================================
// 自作カレンダーのウィジェット（iPhoneのアプリ「Scriptable」用。ロック画面・ホーム画面）
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
  // 終了時刻がない予定は、開始時刻を過ぎたら終わりとする
  const [h, m] = (e.end || e.start).split(":").map(Number);
  const end = new Date(now); end.setHours(h, m, 0, 0);
  return end <= now;
}
// 次に表示が変わる時刻（今日の予定が消える時刻）。15分より早ければその時刻に更新を頼む
function refreshTime(events, now) {
  let t = new Date(now.getTime() + 15 * 60 * 1000);
  if (!events) return t;
  for (const e of eventsOn(events, ymd(now))) {
    if (!e.start || e.pos === "first" || e.pos === "middle") continue;
    const [h, m] = (e.end || e.start).split(":").map(Number);
    const d = new Date(now); d.setHours(h, m, 0, 0);
    if (d > now && d < t) t = d;
  }
  return t;
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
// 次の予定を近い順に並べる（ロック画面用。withLight が false なら白い予定は出さない）
function nextItems(events, now, max, withLight) {
  const out = [];
  const today = ymd(now);
  for (let i = 0; i <= DAYS_AHEAD && out.length < max; i++) {
    const ds = addDays(today, i);
    let evs = eventsOn(events, ds).filter((e) => withLight || !isLight(e.color));
    if (i === 0) evs = evs.filter((e) => !isOver(e, now));
    for (const e of evs) {
      if (out.length >= max) break;
      out.push({ e, date: ds, diff: i });
    }
  }
  return out;
}
function shortDay(ds, diff) {
  if (diff === 0) return "";
  if (diff === 1) return "明日 ";
  const d = parseYmd(ds);
  return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]}) `;
}
// ===== ここまで（予定の計算） =====



function dayLabel(ds, today) {
  const d = parseYmd(ds);
  const base = `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
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
  w.refreshAfterDate = refreshTime(events, now);
  const small = family === "small";
  w.setPadding(small ? 12 : 14, small ? 12 : 16, small ? 10 : 12, small ? 12 : 16);

  // 見出し：今日の日付
  const head = w.addStack();
  head.centerAlignContent();
  const d = now;
  const dayNo = head.addText(`${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`);
  dayNo.font = Font.boldSystemFont(small ? 17 : 17);
  dayNo.textColor = d.getDay() === 0 ? RED : d.getDay() === 6 ? BLUE : FG;
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
  let days = upcoming(events, now, maxLines);
  // 今日の予定がない（終わった）ときは、先に「今日の予定はなし」を出してから明日以降を出す
  if (!days.length || days[0].date !== today) {
    const t = w.addText("今日の予定はなし");
    t.font = Font.systemFont(small ? 11 : 13);
    t.textColor = SUB;
    w.addSpacer(small ? 3 : 4);
    days = upcoming(events, now, maxLines - 1);
  }
  if (!days.length) {
    const t = w.addText(`${DAYS_AHEAD}日先まで予定はありません`);
    t.font = Font.systemFont(11);
    t.textColor = SUB;
  }
  const fs = small ? 11 : 13;
  for (const day of days) {
    if (day.date !== today) { // 今日はいちばん上に日付が出ているので、見出しは付けない
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

// ===== ロック画面のウィジェット =====
function buildAccessory(family, events, note) {
  const now = new Date();
  const w = new ListWidget();
  w.url = APP_URL;
  w.refreshAfterDate = refreshTime(events, now);
  const items = events ? nextItems(events, now, 3) : [];
  const label = (x) => `${shortDay(x.date, x.diff)}${timeText(x.e) === "終日" ? "" : timeText(x.e) + " "}${x.e.title || "（無題）"}`;

  // 時計の上の1行
  if (family === "accessoryInline") {
    const t = w.addText(!events ? "予定を読み込めません"
      : !items.length ? "予定なし"
      : items[0].diff === 0 ? label(items[0]) : `今日なし・${label(items[0])}`);
    t.lineLimit = 1;
    return w;
  }

  // 丸いもの：次の予定の時間とタイトル
  if (family === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    w.setPadding(4, 4, 4, 4);
    w.addSpacer();
    if (!items.length) {
      const t = w.addText(String(now.getDate()));
      t.font = Font.boldSystemFont(20);
      t.centerAlignText();
      const s2 = w.addText(events ? "予定なし" : "—");
      s2.font = Font.systemFont(9);
      s2.centerAlignText();
    } else {
      const x = items[0];
      const top = x.diff === 0 ? timeText(x.e) : x.diff === 1 ? "明日" : `${parseYmd(x.date).getDate()}日`;
      const t = w.addText(top);
      t.font = Font.boldSystemFont(top.length > 4 ? 12 : 14);
      t.minimumScaleFactor = 0.6;
      t.lineLimit = 1;
      t.centerAlignText();
      const ti = w.addText(x.e.title || "（無題）");
      ti.font = Font.systemFont(9);
      ti.lineLimit = 2;
      ti.minimumScaleFactor = 0.7;
      ti.centerAlignText();
    }
    w.addSpacer();
    return w;
  }

  // 長方形：4行まで。今日の予定は時刻から始め、明日以降は「明日」「11/7(土)」の見出しの下に並べる
  w.setPadding(0, 0, 0, 0);
  const MAX = 4;
  if (!events) {
    const t = w.addText(note || "予定を読み込めません");
    t.font = Font.systemFont(11);
    t.lineLimit = 3;
    w.addSpacer();
    return w;
  }
  const all = nextItems(events, now, 8, true);
  const lines = []; // { head } または { x }
  if (!all.some((x) => x.diff === 0)) lines.push({ text: "今日の予定はなし" });
  let cur = null;
  for (const x of all) {
    if (x.diff !== 0 && x.date !== cur) {
      if (lines.length >= MAX - 1) break; // 見出しだけで終わらないようにする
      lines.push({ head: x.diff === 1 ? "明日" : shortDay(x.date, x.diff).trim() });
      cur = x.date;
    }
    if (lines.length >= MAX) break;
    lines.push({ x });
  }
  if (!all.length) lines.push({ text: `${DAYS_AHEAD}日先まで予定はありません` });

  for (const ln of lines) {
    if (ln.text) {
      const t = w.addText(ln.text);
      t.font = Font.systemFont(11);
      t.textOpacity = 0.7;
      t.lineLimit = 1;
      continue;
    }
    if (ln.head) {
      const t = w.addText(ln.head);
      t.font = Font.semiboldSystemFont(10);
      t.textOpacity = 0.7;
      t.lineLimit = 1;
      continue;
    }
    const e = ln.x.e;
    const light = isLight(e.color);
    const row = w.addStack();
    row.centerAlignContent();
    const bar = row.addStack();
    bar.size = new Size(3, 12);
    bar.cornerRadius = 1.5;
    bar.backgroundColor = light ? new Color("#ffffff", 0.35) : new Color(colorHex(e.color));
    row.addSpacer(4);
    const tm = timeText(e);
    if (tm !== "終日") { // 終日の予定はタイトルだけ
      const tt = row.addText(tm);
      tt.font = Font.mediumMonospacedSystemFont(11);
      tt.lineLimit = 1;
      row.addSpacer(4);
    }
    const ti = row.addText(e.title || "（無題）");
    ti.font = Font.systemFont(12);
    ti.lineLimit = 1;
    if (light) ti.textOpacity = 0.6;
    row.addSpacer();
  }
  w.addSpacer();
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
    const kinds = [
      ["ロック画面（長方形）", "accessoryRectangular"],
      ["ロック画面（時計の上）", "accessoryInline"],
      ["ロック画面（丸）", "accessoryCircular"],
      ["ホーム画面（小）", "small"],
      ["ホーム画面（中）", "medium"],
      ["ホーム画面（大）", "large"]
    ];
    kinds.forEach(([name]) => menu.addAction(`プレビュー：${name}`));
    menu.addAction(token ? "トークンを入れ直す" : "トークンを入れる");
    menu.addCancelAction("閉じる");
    const i = await menu.presentSheet();
    if (i === -1) return;
    if (i === kinds.length) { token = await askToken(); if (!token) return; family = "accessoryRectangular"; }
    else family = kinds[i][1];
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

  const w = family.startsWith("accessory") ? buildAccessory(family, events, note) : build(family, events, note);
  if (config.runsInWidget) {
    Script.setWidget(w);
  } else if (family === "accessoryRectangular") {
    await w.presentAccessoryRectangular();
  } else if (family === "accessoryInline") {
    await w.presentAccessoryInline();
  } else if (family === "accessoryCircular") {
    await w.presentAccessoryCircular();
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
