import { useState, useEffect, useRef } from "react";

// ─── Colours ────────────────────────────────────────────────
const PHASE_COLORS = ["#3b82f6","#6366f1","#8b5cf6","#a855f7","#ec4899","#f59e0b","#10b981"];

// ─── Helpers ────────────────────────────────────────────────

// Always returns today's date string in Malaysian time (UTC+8)
const todayStr = () => {
  const now = new Date();
  const malaysiaOffset = 8 * 60; // UTC+8 in minutes
  const localOffset = now.getTimezoneOffset(); // local offset behind UTC
  const malaysia = new Date(now.getTime() + (malaysiaOffset + localOffset) * 60000);
  const y = malaysia.getFullYear();
  const m = String(malaysia.getMonth() + 1).padStart(2, "0");
  const d = String(malaysia.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

// Returns ms until next midnight in Malaysian time
const msUntilMalaysiaMidnight = () => {
  const now = new Date();
  const malaysiaOffset = 8 * 60;
  const localOffset = now.getTimezoneOffset();
  const malaysia = new Date(now.getTime() + (malaysiaOffset + localOffset) * 60000);
  const nextMidnight = new Date(malaysia);
  nextMidnight.setHours(24, 0, 0, 0);
  return nextMidnight - malaysia;
};
const fmt = (n, currency) => {
  const rounded = Math.round(Math.abs(n)).toLocaleString();
  if (currency === "dollar") return `$${rounded}`;
  return `${rounded}¢`;
};
const fmtSigned = (n, currency) => (n >= 0 ? "+" : "-") + fmt(n, currency);

function addTradingDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d.toISOString().split("T")[0];
}

function nextTradingDay(dateStr) {
  return addTradingDays(dateStr, 1);
}

// Generate schedule from user settings
function buildSchedule(startBalance, goalBalance, startDate, dailyGrowthPct, weeksToGoal) {
  const growth = dailyGrowthPct / 100;
  const targets = [];

  // Figure out how many trading days we have
  const endDate = addTradingDays(startDate, weeksToGoal * 5);

  // Build phase milestones (log scale between start and goal, 7 phases)
  const logStart = Math.log10(startBalance);
  const logEnd = Math.log10(goalBalance);
  const phaseCount = 7;
  const milestones = Array.from({ length: phaseCount - 1 }, (_, i) =>
    Math.round(Math.pow(10, logStart + ((logEnd - logStart) * (i + 1)) / phaseCount))
  );
  milestones.push(goalBalance);

  // For each phase, generate daily targets
  let currentDate = startDate;
  let balance = startBalance;
  let phaseIdx = 0;

  while (balance < goalBalance && currentDate <= endDate) {
    const phaseTarget = milestones[phaseIdx];
    const phaseName = `Phase ${phaseIdx + 1}`;

    while (balance < phaseTarget && currentDate <= endDate) {
      balance = Math.min(Math.round(balance * (1 + growth)), phaseTarget);
      targets.push({
        phase: phaseName,
        phaseIdx,
        date: currentDate,
        target: balance,
        milestone: balance >= phaseTarget,
      });
      if (balance < phaseTarget) currentDate = nextTradingDay(currentDate);
    }

    if (balance >= phaseTarget && phaseIdx < phaseCount - 1) {
      phaseIdx++;
      currentDate = nextTradingDay(currentDate);
    } else {
      break;
    }
  }

  return { targets, milestones, endDate };
}

// ─── Sub-components ─────────────────────────────────────────
function Bar({ pct, color, h = 10 }) {
  return (
    <div style={{ background: "#0f172a", borderRadius: 99, height: h, overflow: "hidden" }}>
      <div style={{ width: `${Math.min(Math.max(pct, 0), 100)}%`, height: "100%", background: color, borderRadius: 99, transition: "width 0.4s" }} />
    </div>
  );
}

function PerfChart({ trades, currency }) {
  const pts = [...trades].reverse().map(t => t.balanceAfter);
  if (pts.length < 2) return (
    <div style={{ height: 90, display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", fontSize: 12 }}>
      Log 2+ trades to see your curve
    </div>
  );
  const W = 340, H = 90, pad = 10;
  const mn = Math.min(...pts), mx = Math.max(...pts), rng = mx - mn || 1;
  const coords = pts.map((v, i) => {
    const x = pad + (i / (pts.length - 1)) * (W - pad * 2);
    const y = H - pad - ((v - mn) / rng) * (H - pad * 2);
    return [x, y];
  });
  const polyline = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `M${coords[0]} L${coords.map(([x, y]) => `${x},${y}`).join(" L")} L${coords[coords.length - 1][0]},${H} L${coords[0][0]},${H} Z`;
  const up = pts[pts.length - 1] >= pts[0];
  const col = up ? "#10b981" : "#ef4444";
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity="0.3" />
          <stop offset="100%" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#g)" />
      <polyline points={polyline} fill="none" stroke={col} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {[0, pts.length - 1].map(i => (
        <circle key={i} cx={coords[i][0]} cy={coords[i][1]} r="3.5" fill={col} />
      ))}
    </svg>
  );
}

// ─── Setup Screen ───────────────────────────────────────────
function SetupScreen({ onComplete }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    currency: "cent",
    startBalance: "",
    goalBalance: "",
    dailyGrowth: "8",
    weeksToGoal: "20",
    startDate: todayStr(),
    maxTrades: "5",
    dailyLossPct: "5",
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const inputStyle = {
    width: "100%", background: "#0f172a", border: "1px solid #334155",
    borderRadius: 8, color: "#f8fafc", fontSize: 16, padding: "13px 14px",
    outline: "none", boxSizing: "border-box",
  };
  const labelStyle = { fontSize: 12, color: "#94a3b8", marginBottom: 6, display: "block" };
  const cardStyle = { background: "#1e293b", borderRadius: 14, padding: 20, marginBottom: 12 };

  const steps = [
    // Step 0: Currency
    <div key={0}>
      <div style={cardStyle}>
        <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Account Type</div>
        <div style={{ display: "flex", gap: 10 }}>
          {[{ id: "cent", label: "¢ Cent Account", sub: "Balance in cents" }, { id: "dollar", label: "$ Dollar Account", sub: "Balance in dollars" }].map(c => (
            <button key={c.id} onClick={() => set("currency", c.id)} style={{
              flex: 1, border: `2px solid ${form.currency === c.id ? "#3b82f6" : "#1e293b"}`,
              borderRadius: 10, padding: "14px 10px", background: form.currency === c.id ? "#3b82f620" : "#0f172a",
              color: form.currency === c.id ? "#f8fafc" : "#64748b", cursor: "pointer", textAlign: "center",
            }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>{c.label.split(" ")[0]}</div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{c.label.split(" ").slice(1).join(" ")}</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{c.sub}</div>
            </button>
          ))}
        </div>
      </div>
    </div>,

    // Step 1: Balances
    <div key={1}>
      <div style={cardStyle}>
        <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Your Balances</div>
        <label style={labelStyle}>Starting balance ({form.currency === "cent" ? "cents" : "dollars"})</label>
        <input type="number" value={form.startBalance} onChange={e => set("startBalance", e.target.value)}
          placeholder={form.currency === "cent" ? "e.g. 1300" : "e.g. 100"} style={{ ...inputStyle, marginBottom: 14 }} />
        <label style={labelStyle}>Goal balance ({form.currency === "cent" ? "cents" : "dollars"})</label>
        <input type="number" value={form.goalBalance} onChange={e => set("goalBalance", e.target.value)}
          placeholder={form.currency === "cent" ? "e.g. 1000000" : "e.g. 10000"} style={inputStyle} />
        {form.startBalance && form.goalBalance && (
          <div style={{ marginTop: 12, background: "#0f172a", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#64748b" }}>
            Growth needed: <span style={{ color: "#f8fafc", fontWeight: 700 }}>
              {(parseFloat(form.goalBalance) / parseFloat(form.startBalance)).toFixed(1)}×
            </span>
          </div>
        )}
      </div>
    </div>,

    // Step 2: Timeline
    <div key={2}>
      <div style={cardStyle}>
        <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Timeline</div>
        <label style={labelStyle}>Start date</label>
        <input type="date" value={form.startDate} onChange={e => set("startDate", e.target.value)}
          style={{ ...inputStyle, marginBottom: 14 }} />
        <label style={labelStyle}>Weeks to reach goal</label>
        <input type="number" value={form.weeksToGoal} onChange={e => set("weeksToGoal", e.target.value)}
          placeholder="e.g. 20" style={inputStyle} />
        {form.weeksToGoal && (
          <div style={{ marginTop: 12, background: "#0f172a", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#64748b" }}>
            Target date: <span style={{ color: "#f8fafc", fontWeight: 700 }}>
              {new Date(addTradingDays(form.startDate, parseInt(form.weeksToGoal) * 5) + "T00:00:00")
                .toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            </span>
          </div>
        )}
      </div>
    </div>,

    // Step 3: Growth & Risk
    <div key={3}>
      <div style={cardStyle}>
        <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Growth & Risk</div>
        <label style={labelStyle}>Daily growth target (%)</label>
        <input type="number" value={form.dailyGrowth} onChange={e => set("dailyGrowth", e.target.value)}
          placeholder="e.g. 8" style={{ ...inputStyle, marginBottom: 14 }} />
        <label style={labelStyle}>Max trades per day</label>
        <input type="number" value={form.maxTrades} onChange={e => set("maxTrades", e.target.value)}
          placeholder="e.g. 5" style={{ ...inputStyle, marginBottom: 14 }} />
        <label style={labelStyle}>Daily loss limit (%)</label>
        <input type="number" value={form.dailyLossPct} onChange={e => set("dailyLossPct", e.target.value)}
          placeholder="e.g. 5" style={inputStyle} />
        <div style={{ marginTop: 12, background: "#0f172a", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#64748b" }}>
          At {form.dailyGrowth}%/day on {form.startBalance || "?"} starting balance — your schedule will be generated automatically.
        </div>
      </div>
    </div>,
  ];

  const canNext = [
    true,
    form.startBalance && form.goalBalance && parseFloat(form.goalBalance) > parseFloat(form.startBalance),
    form.startDate && form.weeksToGoal,
    form.dailyGrowth && form.maxTrades && form.dailyLossPct,
  ];

  function finish() {
    const settings = {
      currency: form.currency,
      startBalance: parseFloat(form.startBalance),
      goalBalance: parseFloat(form.goalBalance),
      dailyGrowth: parseFloat(form.dailyGrowth),
      weeksToGoal: parseInt(form.weeksToGoal),
      startDate: form.startDate,
      maxTrades: parseInt(form.maxTrades),
      dailyLossPct: parseFloat(form.dailyLossPct),
    };
    onComplete(settings);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", color: "#e2e8f0", padding: "0 0 40px" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "40px 20px 0" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#f8fafc", marginBottom: 6 }}>📈 Trader Tracker</div>
          <div style={{ fontSize: 14, color: "#64748b" }}>Set up your personalised trading plan</div>
        </div>

        {/* Step indicators */}
        <div style={{ display: "flex", gap: 6, marginBottom: 28 }}>
          {["Account", "Balances", "Timeline", "Risk"].map((label, i) => (
            <div key={i} style={{ flex: 1, textAlign: "center" }}>
              <div style={{
                height: 4, borderRadius: 99, marginBottom: 4,
                background: i <= step ? PHASE_COLORS[i] : "#1e293b",
                transition: "background 0.2s",
              }} />
              <div style={{ fontSize: 9, color: i === step ? "#f8fafc" : "#334155", fontWeight: i === step ? 700 : 400 }}>{label}</div>
            </div>
          ))}
        </div>

        {steps[step]}

        {/* Nav */}
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)} style={{
              flex: 1, background: "#1e293b", border: "none", borderRadius: 10,
              color: "#94a3b8", fontWeight: 600, fontSize: 14, padding: "14px 0", cursor: "pointer",
            }}>← Back</button>
          )}
          <button
            onClick={() => step < steps.length - 1 ? setStep(s => s + 1) : finish()}
            disabled={!canNext[step]}
            style={{
              flex: 2, background: canNext[step] ? PHASE_COLORS[step] : "#1e293b",
              border: "none", borderRadius: 10, color: canNext[step] ? "#fff" : "#334155",
              fontWeight: 700, fontSize: 14, padding: "14px 0",
              cursor: canNext[step] ? "pointer" : "not-allowed", transition: "all 0.2s",
            }}>
            {step < steps.length - 1 ? "Continue →" : "Start Tracking 🚀"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Tracker ───────────────────────────────────────────
const STORE_KEY = "trader-tracker-v3";

function Tracker({ settings, onReset }) {
  const { currency, startBalance, goalBalance, dailyGrowth, weeksToGoal, startDate, maxTrades, dailyLossPct } = settings;

  const { targets: DAILY_TARGETS, milestones } = buildSchedule(startBalance, goalBalance, startDate, dailyGrowth, weeksToGoal);

  const phaseNames = [...new Set(DAILY_TARGETS.map(d => d.phase))];
  const phaseColors = Object.fromEntries(phaseNames.map((p, i) => [p, PHASE_COLORS[i % PHASE_COLORS.length]]));
  const phaseRanges = Object.fromEntries(phaseNames.map((p, i) => {
    const start = i === 0 ? startBalance : milestones[i - 1];
    const end = milestones[i];
    return [p, { start, end }];
  }));

  const [balance, setBalance] = useState(startBalance);
  const [balInput, setBalInput] = useState(String(startBalance));
  const [trades, setTrades] = useState([]);
  const [logResult, setLogResult] = useState("win");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [logMode, setLogMode] = useState("balance");
  const [newBalInput, setNewBalInput] = useState("");
  const [dayStart, setDayStart] = useState(startBalance);
  const [tab, setTab] = useState("dashboard");
  const [openPhase, setOpenPhase] = useState(null);
  const [quote, setQuote] = useState("");
  const [quoteLoad, setQuoteLoad] = useState(false);
  const [saveTag, setSaveTag] = useState(null);
  const [today, setToday] = useState(todayStr()); // Malaysian time
  const loaded = useRef(false);

  // Auto-refresh at Malaysian midnight
  useEffect(() => {
    let timeout;
    const scheduleRefresh = () => {
      const ms = msUntilMalaysiaMidnight();
      timeout = setTimeout(() => {
        setToday(todayStr());   // flip the date
        scheduleRefresh();      // schedule next midnight
      }, ms);
    };
    scheduleRefresh();
    return () => clearTimeout(timeout);
  }, []);

  const currentPhase = (DAILY_TARGETS.find(d => d.target >= balance) || DAILY_TARGETS[DAILY_TARGETS.length - 1]).phase;
  const phaseColor = phaseColors[currentPhase] || "#3b82f6";
  const phaseRange = phaseRanges[currentPhase] || { start: startBalance, end: goalBalance };

  const todayTgt = DAILY_TARGETS.find(d => d.date === today) || DAILY_TARGETS.find(d => d.date > today) || DAILY_TARGETS[DAILY_TARGETS.length - 1];
  const riskPct = parseFloat(dailyGrowth) > 10 ? 2 : parseFloat(dailyGrowth) > 6 ? 1.5 : 1;
  const riskAmt = Math.round(balance * riskPct / 100);
  const lossLimit = Math.round(dayStart * dailyLossPct / 100);

  const todayTrades = trades.filter(t => t.date === today);
  const todayPnl = todayTrades.reduce((s, t) => s + t.pnl, 0);
  const todayW = todayTrades.filter(t => t.pnl > 0).length;
  const todayL = todayTrades.filter(t => t.pnl < 0).length;
  const allW = trades.filter(t => t.pnl > 0).length;
  const winRate = trades.length ? ((allW / trades.length) * 100).toFixed(1) : null;

  const lossHit = todayPnl <= -lossLimit;
  const capHit = todayTrades.length >= maxTrades;
  const ahead = balance >= (todayTgt?.target || goalBalance);

  const pPct = ((balance - phaseRange.start) / (phaseRange.end - phaseRange.start)) * 100;
  const totPct = ((balance - startBalance) / (goalBalance - startBalance)) * 100;

  // When Malaysian midnight hits — reset daily baseline to current balance
  useEffect(() => {
    if (!loaded.current) return;
    setDayStart(balance);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  // Load from localStorage
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY));
      if (saved) {
        if (saved.balance) { setBalance(saved.balance); setBalInput(String(saved.balance)); }
        if (saved.trades) setTrades(saved.trades);
        if (saved.dayStart) setDayStart(saved.dayStart);
      }
    } catch { }
    loaded.current = true;
  }, []);

  // Persist on change
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ balance, trades, dayStart }));
      setSaveTag("✓");
    } catch {
      setSaveTag("!");
    }
    const t = setTimeout(() => setSaveTag(null), 1500);
    return () => clearTimeout(t);
  }, [balance, trades, dayStart]);

  // Daily quote
  useEffect(() => {
    const key = "qt-" + today;
    const cached = (() => { try { return localStorage.getItem(key); } catch { return null; } })();
    if (cached) { setQuote(cached); return; }
    setQuoteLoad(true);
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 80,
        messages: [{ role: "user", content: `Write one short punchy motivational line for a forex trader grinding from ${fmt(startBalance, currency)} to ${fmt(goalBalance, currency)}. Be direct and original. Under 18 words. No quotes, no attribution, just the line.` }]
      })
    })
      .then(r => r.json())
      .then(d => {
        const q = d?.content?.[0]?.text?.trim() || "Discipline today builds the account of tomorrow.";
        setQuote(q);
        try { localStorage.setItem(key, q); } catch { }
      })
      .catch(() => setQuote("Small lots, big dreams. Trust the process."))
      .finally(() => setQuoteLoad(false));
  }, [today]);

  function logTrade() {
    let pnl, newBal;
    if (logMode === "balance") {
      const nb = parseFloat(newBalInput);
      if (isNaN(nb) || nb <= 0) return;
      pnl = Math.round((nb - balance) * 100) / 100;
      newBal = nb;
    } else {
      const amt = parseFloat(amount);
      if (!amt || amt <= 0) return;
      pnl = logResult === "win" ? amt : -amt;
      newBal = Math.round((balance + pnl) * 100) / 100;
    }
    const tradeResult = pnl >= 0 ? "win" : "loss";
    setTrades(prev => [{ id: Date.now(), date: today, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), result: tradeResult, pnl, balanceAfter: newBal, note }, ...prev]);
    setBalance(newBal);
    setBalInput(String(Math.round(newBal)));
    setAmount(""); setNewBalInput(""); setNote("");
  }

  function applyBal() {
    const v = parseFloat(balInput);
    if (!isNaN(v) && v > 0) { setBalance(v); setDayStart(v); }
  }

  const statusColor = lossHit ? "#ef4444" : capHit ? "#f59e0b" : ahead ? "#10b981" : "#3b82f6";
  const statusMsg = lossHit ? "🛑 Loss limit hit" : capHit ? "⚠️ Max trades" : ahead ? "✅ Target hit" : "📈 Active";
  const TABS = ["dashboard", "log", "performance", "schedule", "history"];

  const inputStyle = {
    width: "100%", background: "#0f172a", border: "1px solid #334155",
    borderRadius: 8, color: "#f8fafc", fontSize: 15, padding: "12px",
    outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", color: "#e2e8f0", fontFamily: "'Inter','Segoe UI',sans-serif", paddingBottom: 48 }}>

      {/* Header */}
      <div style={{ borderBottom: "1px solid #1e293b", padding: "18px 20px 0" }}>
        <div style={{ maxWidth: 680, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 2 }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 2, color: "#334155", textTransform: "uppercase", marginBottom: 2 }}>
                Trader Tracker · MYT {new Date(new Date().getTime() + (8 * 60 + new Date().getTimezoneOffset()) * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {saveTag === "✓" && <span style={{ color: "#10b981", marginLeft: 6 }}>· saved ✓</span>}
                {saveTag === "!" && <span style={{ color: "#f59e0b", marginLeft: 6 }}>· save error</span>}
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "#f8fafc", letterSpacing: -0.5 }}>
                {fmt(balance, currency)}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: statusColor, background: statusColor + "18", borderRadius: 20, padding: "4px 10px" }}>{statusMsg}</span>
              <button onClick={onReset} style={{ fontSize: 10, color: "#334155", background: "none", border: "none", cursor: "pointer" }}>⚙ Settings</button>
            </div>
          </div>

          {/* Phase bar */}
          <div style={{ margin: "10px 0 4px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: phaseColor, fontWeight: 600 }}>{currentPhase} · {fmt(phaseRange.start, currency)} → {fmt(phaseRange.end, currency)}</span>
              <span style={{ fontSize: 11, color: "#475569" }}>{Math.max(0, pPct).toFixed(1)}%</span>
            </div>
            <Bar pct={pPct} color={phaseColor} />
          </div>

          {/* Overall bar */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: 10, color: "#334155" }}>Overall to {fmt(goalBalance, currency)}</span>
              <span style={{ fontSize: 10, color: "#10b981" }}>{Math.max(0, totPct).toFixed(2)}%</span>
            </div>
            <Bar pct={totPct} color="#10b981" h={6} />
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", overflowX: "auto" }}>
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                background: "none", border: "none",
                borderBottom: tab === t ? `2px solid ${phaseColor}` : "2px solid transparent",
                color: tab === t ? "#f8fafc" : "#475569", fontWeight: tab === t ? 700 : 400,
                fontSize: 12, padding: "8px 12px 10px", cursor: "pointer", textTransform: "capitalize", whiteSpace: "nowrap",
              }}>{t}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 680, margin: "18px auto", padding: "0 16px" }}>

        {/* ── DASHBOARD ── */}
        {tab === "dashboard" && (
          <div>
            {/* Quote */}
            <div style={{ background: "linear-gradient(135deg,#1e293b,#0d1f35)", borderRadius: 12, padding: 16, marginBottom: 12, borderLeft: `3px solid ${phaseColor}` }}>
              <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Today's Quote</div>
              {quoteLoad
                ? <div style={{ color: "#334155", fontSize: 13 }}>Generating…</div>
                : <div style={{ fontSize: 14, color: "#cbd5e1", fontStyle: "italic", lineHeight: 1.6 }}>"{quote}"</div>}
            </div>

            {/* Today target */}
            <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 12, borderLeft: `3px solid ${ahead ? "#10b981" : phaseColor}` }}>
              <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Today · {todayTgt?.date}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontSize: 22, fontWeight: 800, color: ahead ? "#10b981" : "#f8fafc" }}>{fmt(todayTgt?.target || goalBalance, currency)}</span>
                  {todayTgt?.milestone && <span style={{ marginLeft: 8, fontSize: 10, background: phaseColor + "30", color: phaseColor, borderRadius: 20, padding: "2px 7px", fontWeight: 700 }}>MILESTONE</span>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: "#64748b" }}>Gap</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: ahead ? "#10b981" : "#f59e0b" }}>
                    {ahead ? "✓ Done" : fmt((todayTgt?.target || goalBalance) - balance, currency)}
                  </div>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
              {[
                { label: "Today P&L", value: fmtSigned(todayPnl, currency), color: todayPnl >= 0 ? "#10b981" : "#ef4444" },
                { label: "Trades", value: `${todayTrades.length}/${maxTrades}`, color: capHit ? "#f59e0b" : "#e2e8f0" },
                { label: "Win Rate", value: winRate ? winRate + "%" : "—", color: "#8b5cf6" },
              ].map(s => (
                <div key={s.label} style={{ background: "#1e293b", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>{s.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Risk guide */}
            <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: "#64748b", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Risk Guide · {currentPhase}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  { label: `Risk/Trade (~${riskPct}%)`, value: fmt(riskAmt, currency) },
                  { label: `Daily Loss Limit (${dailyLossPct}%)`, value: fmt(lossLimit, currency) },
                  { label: "W / L Today", value: `${todayW}W · ${todayL}L` },
                  { label: "Daily Growth Target", value: dailyGrowth + "%/day" },
                ].map(r => (
                  <div key={r.label} style={{ background: "#0f172a", borderRadius: 8, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "#64748b" }}>{r.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#f8fafc" }}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Sync Balance */}
            <div style={{ background: "#1e293b", borderRadius: 12, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>Sync Balance</div>
                <span style={{ fontSize: 10, color: "#475569" }}>Always available</span>
              </div>
              <div style={{ fontSize: 12, color: "#475569", marginBottom: 10 }}>Manually set your balance anytime.</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input type="number" value={balInput} onChange={e => setBalInput(e.target.value)}
                  style={{ flex: 1, background: "#0f172a", border: "1px solid #334155", borderRadius: 8, color: "#f8fafc", fontSize: 14, padding: "10px 12px", outline: "none" }}
                  placeholder={`Balance in ${currency === "cent" ? "cents" : "dollars"}`} />
                <button onClick={applyBal} style={{ background: phaseColor, border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, fontSize: 13, padding: "0 16px", cursor: "pointer" }}>Set</button>
              </div>
              <button onClick={() => setDayStart(balance)} style={{ marginTop: 8, background: "none", border: "1px solid #1e293b", borderRadius: 8, color: "#64748b", fontSize: 11, padding: "7px 12px", cursor: "pointer", width: "100%" }}>
                Reset daily baseline to {fmt(balance, currency)}
              </button>
            </div>
          </div>
        )}

        {/* ── LOG ── */}
        {tab === "log" && (
          <div>
            <div style={{ display: "flex", background: "#1e293b", borderRadius: 10, padding: 3, marginBottom: 12 }}>
              {[{ id: "balance", label: "📲 Enter New Balance" }, { id: "amount", label: "✏️ Enter Amount" }].map(m => (
                <button key={m.id} onClick={() => setLogMode(m.id)} style={{
                  flex: 1, border: "none", borderRadius: 8, padding: "10px 0",
                  background: logMode === m.id ? phaseColor : "transparent",
                  color: logMode === m.id ? "#fff" : "#64748b",
                  fontWeight: 700, fontSize: 12, cursor: "pointer", transition: "all 0.15s",
                }}>{m.label}</button>
              ))}
            </div>

            <div style={{ background: "#1e293b", borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>Log a Trade</div>

              {/* Warnings */}
              {lossHit && logMode === "amount" && (
                <div style={{ background: "#ef444418", border: "1px solid #ef4444", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 12, color: "#ef4444" }}>
                  ⚠️ Daily loss limit hit. You can still log or update balance.
                </div>
              )}
              {capHit && logMode === "amount" && (
                <div style={{ background: "#f59e0b18", border: "1px solid #f59e0b", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 12, color: "#f59e0b" }}>
                  ⚠️ Max trades reached for today.
                </div>
              )}
              {ahead && (
                <div style={{ background: "#10b98118", border: "1px solid #10b981", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 12, color: "#10b981" }}>
                  ✅ Daily target hit! Keep going or rest — your call.
                </div>
              )}

              {/* Balance mode */}
              {logMode === "balance" && (
                <>
                  <div style={{ background: "#0f172a", borderRadius: 10, padding: "12px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: "#64748b" }}>Current balance</span>
                    <span style={{ fontSize: 15, fontWeight: 800, color: "#f8fafc" }}>{fmt(balance, currency)}</span>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 5 }}>New balance after trade ({currency === "cent" ? "cents" : "dollars"})</div>
                    <input type="number" value={newBalInput} onChange={e => setNewBalInput(e.target.value)}
                      placeholder={currency === "cent" ? "e.g. 1450" : "e.g. 105.50"} style={inputStyle} />
                  </div>
                  {newBalInput && !isNaN(parseFloat(newBalInput)) && (
                    <div style={{ background: "#0f172a", borderRadius: 10, padding: "12px 14px", marginBottom: 14, borderLeft: `3px solid ${parseFloat(newBalInput) >= balance ? "#10b981" : "#ef4444"}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: "#64748b" }}>P&L</span>
                        <span style={{ fontSize: 18, fontWeight: 800, color: parseFloat(newBalInput) >= balance ? "#10b981" : "#ef4444" }}>
                          {parseFloat(newBalInput) >= balance ? "+" : ""}{fmt(parseFloat(newBalInput) - balance, currency)}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                        <span style={{ fontSize: 12, color: "#64748b" }}>Result</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: parseFloat(newBalInput) >= balance ? "#10b981" : "#ef4444" }}>
                          {parseFloat(newBalInput) >= balance ? "✅ Win" : "❌ Loss"}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Amount mode */}
              {logMode === "amount" && (
                <>
                  <div style={{ display: "flex", background: "#0f172a", borderRadius: 8, padding: 3, marginBottom: 14 }}>
                    {["win", "loss"].map(r => (
                      <button key={r} onClick={() => setLogResult(r)} style={{
                        flex: 1, border: "none", borderRadius: 6, padding: "11px 0",
                        background: logResult === r ? (r === "win" ? "#10b981" : "#ef4444") : "transparent",
                        color: logResult === r ? "#fff" : "#64748b", fontWeight: 700, fontSize: 14, cursor: "pointer",
                      }}>{r === "win" ? "✅ Win" : "❌ Loss"}</button>
                    ))}
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 5 }}>Amount ({currency === "cent" ? "cents" : "dollars"})</div>
                    <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                      placeholder={`Suggested: ${fmt(riskAmt, currency)} (${riskPct}% risk)`} style={inputStyle} />
                  </div>
                  {amount && (
                    <div style={{ background: "#0f172a", borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>
                      <span style={{ fontSize: 12, color: "#64748b" }}>After trade: </span>
                      <span style={{ fontSize: 15, fontWeight: 700, color: logResult === "win" ? "#10b981" : "#ef4444" }}>
                        {fmt(balance + (logResult === "win" ? +amount : -amount), currency)}
                      </span>
                    </div>
                  )}
                </>
              )}

              {/* Note */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 5 }}>Note (optional)</div>
                <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. EUR/USD breakout…" style={inputStyle} />
              </div>

              <button onClick={logTrade} disabled={logMode === "balance" ? !newBalInput : !amount} style={{
                width: "100%", background: phaseColor, border: "none", borderRadius: 8,
                color: "#fff", fontWeight: 700, fontSize: 15, padding: "14px 0", cursor: "pointer",
                opacity: (logMode === "balance" ? !newBalInput : !amount) ? 0.4 : 1,
              }}>
                {logMode === "balance" ? "Update Balance & Log" : "Log Trade"}
              </button>
            </div>

            {todayTrades.length > 0 && (
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                {[{ label: "Wins", val: todayW, color: "#10b981" }, { label: "Losses", val: todayL, color: "#ef4444" }, { label: "P&L", val: fmtSigned(todayPnl, currency), color: todayPnl >= 0 ? "#10b981" : "#ef4444" }].map(s => (
                  <div key={s.label} style={{ flex: 1, background: "#1e293b", borderRadius: 8, padding: 10, textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.val}</div>
                    <div style={{ fontSize: 10, color: "#64748b" }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── PERFORMANCE ── */}
        {tab === "performance" && (
          <div>
            <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Balance Curve</div>
              <PerfChart trades={trades} currency={currency} />
              {trades.length >= 2 && (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                  <span style={{ fontSize: 11, color: "#475569" }}>First: {fmt([...trades].reverse()[0]?.balanceAfter, currency)}</span>
                  <span style={{ fontSize: 11, color: "#475569" }}>Now: {fmt(balance, currency)}</span>
                </div>
              )}
            </div>

            {/* Daily P&L bars */}
            {(() => {
              const byDay = {};
              trades.forEach(t => { byDay[t.date] = (byDay[t.date] || 0) + t.pnl; });
              const days = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])).slice(-10);
              if (!days.length) return null;
              const maxAbs = Math.max(...days.map(([, v]) => Math.abs(v)), 1);
              return (
                <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>Daily P&L (last 10 days)</div>
                  {days.map(([date, pnl]) => {
                    const pct = (Math.abs(pnl) / maxAbs) * 100;
                    const pos = pnl >= 0;
                    const lbl = new Date(date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
                    return (
                      <div key={date} style={{ marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                          <span style={{ fontSize: 11, color: "#64748b" }}>{lbl}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: pos ? "#10b981" : "#ef4444" }}>{pos ? "+" : ""}{fmt(pnl, currency)}</span>
                        </div>
                        <div style={{ background: "#0f172a", borderRadius: 99, height: 7, overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: pos ? "#10b981" : "#ef4444", borderRadius: 99 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* All-time stats */}
            <div style={{ background: "#1e293b", borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>All-time Stats</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  { label: "Total Trades", value: trades.length },
                  { label: "Win Rate", value: winRate ? winRate + "%" : "—" },
                  { label: "Total Wins", value: allW },
                  { label: "Total Losses", value: trades.length - allW },
                  { label: "Best Trade", value: trades.length ? "+" + fmt(Math.max(...trades.map(t => t.pnl)), currency) : "—" },
                  { label: "Worst Trade", value: trades.length ? fmt(Math.min(...trades.map(t => t.pnl)), currency) : "—" },
                ].map(s => (
                  <div key={s.label} style={{ background: "#0f172a", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, color: "#64748b", marginBottom: 2 }}>{s.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc" }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── SCHEDULE ── */}
        {tab === "schedule" && (
          <div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>
              {DAILY_TARGETS.length} trading days · {startDate} → {addTradingDays(startDate, weeksToGoal * 5)}
            </div>
            {phaseNames.map(ph => {
              const pts = DAILY_TARGETS.filter(d => d.phase === ph);
              const col = phaseColors[ph];
              const done = balance >= (pts[pts.length - 1]?.target || goalBalance);
              const active = pts.some(d => d.target >= balance) && !done;
              const range = phaseRanges[ph];
              return (
                <div key={ph} style={{ background: "#1e293b", borderRadius: 12, marginBottom: 10, overflow: "hidden" }}>
                  <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", borderLeft: `3px solid ${active ? col : done ? "#10b981" : "#334155"}` }}
                    onClick={() => setOpenPhase(openPhase === ph ? null : ph)}>
                    <div>
                      <span style={{ fontWeight: 700, color: active ? col : done ? "#10b981" : "#64748b", fontSize: 13 }}>{ph}</span>
                      <span style={{ fontSize: 11, color: "#475569", marginLeft: 8 }}>{fmt(range?.start, currency)} → {fmt(range?.end, currency)}</span>
                    </div>
                    <span style={{ fontSize: 12, color: done ? "#10b981" : active ? col : "#475569" }}>{done ? "✓" : active ? "active" : "▸"}</span>
                  </div>
                  {openPhase === ph && (
                    <div style={{ borderTop: "1px solid #0f172a" }}>
                      {pts.map(d => {
                        const isT = d.date === today, isPast = d.date < today;
                        return (
                          <div key={d.date} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 16px", background: isT ? col + "12" : "transparent", borderLeft: isT ? `2px solid ${col}` : "2px solid transparent", opacity: isPast ? 0.4 : 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 11, color: isT ? col : "#475569", fontWeight: isT ? 700 : 400 }}>
                                {new Date(d.date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                              </span>
                              {d.milestone && <span style={{ fontSize: 9, background: col + "30", color: col, borderRadius: 10, padding: "1px 6px", fontWeight: 700 }}>MILESTONE</span>}
                              {isT && <span style={{ fontSize: 9, background: col, color: "#fff", borderRadius: 10, padding: "1px 6px", fontWeight: 700 }}>TODAY</span>}
                            </div>
                            <span style={{ fontSize: 13, fontWeight: d.milestone ? 800 : 600, color: d.milestone ? col : "#94a3b8" }}>{fmt(d.target, currency)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── HISTORY ── */}
        {tab === "history" && (
          <div>
            {!trades.length
              ? <div style={{ textAlign: "center", color: "#475569", padding: "60px 0", fontSize: 14 }}>No trades logged yet.</div>
              : <>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>{trades.length} trades · Win rate: {winRate}%</div>
                {trades.map(t => (
                  <div key={t.id} style={{ background: "#1e293b", borderRadius: 10, padding: "11px 14px", marginBottom: 8, borderLeft: `3px solid ${t.pnl > 0 ? "#10b981" : "#ef4444"}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: t.pnl > 0 ? "#10b981" : "#ef4444" }}>{t.pnl > 0 ? "+" : ""}{fmt(t.pnl, currency)}</div>
                      <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{t.date} {t.time}{t.note ? ` · ${t.note}` : ""}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 11, color: "#64748b" }}>Balance</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#f8fafc" }}>{fmt(t.balanceAfter, currency)}</div>
                    </div>
                  </div>
                ))}
              </>
            }
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Root ───────────────────────────────────────────────────
const SETTINGS_KEY = "trader-settings-v3";

export default function App() {
  const [settings, setSettings] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if (saved) setSettings(saved);
    } catch { }
    setLoaded(true);
  }, []);

  function handleSetup(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    setSettings(s);
  }

  function handleReset() {
    if (window.confirm("Reset settings? Your trade history will be cleared.")) {
      localStorage.removeItem(SETTINGS_KEY);
      localStorage.removeItem("trader-tracker-v3");
      setSettings(null);
    }
  }

  if (!loaded) return null;
  if (!settings) return <SetupScreen onComplete={handleSetup} />;
  return <Tracker settings={settings} onReset={handleReset} />;
}
