
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCSj__eG6LftnnxxJD7SvJ2Up_-Si_tP9o",
  authDomain: "open-house-bbq.firebaseapp.com",
  projectId: "open-house-bbq",
  storageBucket: "open-house-bbq.firebasestorage.app",
  messagingSenderId: "78187718949",
  appId: "1:78187718949:web:23992e6e9c47b57f8212cc",
  measurementId: "G-H79Y057H79"
};

const ADMIN_EMAILS = ["pedro.ruffo.dev@gmail.com"];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);

let currentUser = null;
let stopClaims = null;
let currentClaims = [];

const ITEMS = [
  ["carne-bovina", "🥩 Carne bovina", 12],
  ["linguica", "🌭 Linguiça", 7],
  ["frango", "🍗 Frango", 6],
  ["pao-alho", "🥖 Pão de alho", 6],
  ["queijo", "🧀 Queijo coalho", 4]
].map(([id, name, capacity]) => ({
  id,
  name,
  category: "Churrasco",
  capacity,
  active: true
}));

const isAdmin = email =>
  ADMIN_EMAILS.includes(String(email || "").trim().toLowerCase());

const userEmail = () =>
  String(currentUser?.email || "").trim().toLowerCase();

function itemById(id) {
  return ITEMS.find(item => item.id === id);
}

function revealPage() {
  window.scrollTo(0, 0);
  document.documentElement.classList.remove("auth-pending");
  requestAnimationFrame(() => window.scrollTo(0, 0));
}

function showMessage(message) {
  const notice = $("notice");
  notice.classList.remove("is-welcome", "is-confirmed");
  notice.classList.add("is-alert");
  $("noticeTitle").textContent = message;
  $("noticeText").textContent = "";
  $("openVoucher").classList.add("hidden");
}

function showWelcome(name, detail, canOpenVoucher = false) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  const shown = parts.length <= 2
    ? parts.join(" ")
    : `${parts[0]} ${parts[parts.length - 1]}`;
  const notice = $("notice");
  notice.classList.remove("is-alert");
  notice.classList.add("is-welcome");
  notice.classList.toggle("is-confirmed", canOpenVoucher);
  $("guestName").textContent = shown ? `${shown}!` : "Olá!";
  $("noticeTitle").textContent = "";
  $("noticeText").textContent = detail;
  $("openVoucher").classList.toggle("hidden", !canOpenVoucher);
}

function setView(view) {
  const adminView = view === "admin" && isAdmin(userEmail());
  $("homeView").classList.toggle("hidden", adminView);
  $("admin").classList.toggle("hidden", !adminView);
  $("tabHome").classList.toggle("is-active", !adminView);
  $("tabAdmin").classList.toggle("is-active", adminView);
  $("tabHome").setAttribute("aria-selected", String(!adminView));
  $("tabAdmin").setAttribute("aria-selected", String(adminView));
}

function setBusy(button, busy, text) {
  if (!button) return;

  if (!button.dataset.originalText) {
    button.dataset.originalText = button.textContent;
  }

  button.disabled = busy;
  button.textContent = busy ? text : button.dataset.originalText;
}

// Menu do usuário
$("userMenuButton").onclick = () => {
  $("userDropdown").classList.toggle("hidden");
};

document.addEventListener("click", event => {
  if (!event.target.closest(".user-menu")) {
    $("userDropdown").classList.add("hidden");
  }
});

$("logout").onclick = async () => {
  await signOut(auth);
  $("userDropdown").classList.add("hidden");
};

$("openHistory").onclick = () => {
  openHistory().catch(error => {
    console.error(error);
    $("historyList").innerHTML = '<p class="history-empty">Não foi possível carregar o histórico.</p>';
  });
};

$("closeHistory").onclick = closeHistory;

// Login Google
$("login").onclick = async () => {
  if (auth.currentUser) {
    await signOut(auth);
    return;
  }

  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
};

// Autenticação
onAuthStateChanged(auth, async user => {
  currentUser = user;

  if (user) document.documentElement.classList.add("auth-pending");

  $("login").classList.toggle("hidden", !!user);
  $("userMenu").classList.toggle("hidden", !user);

  if (user) {
    const name = user.displayName || "Minha conta";
    const email = user.email || "";

    $("userName").textContent = name.split(" ")[0];
    $("dropdownName").textContent = name;
    $("dropdownEmail").textContent = email;

    $("userAvatar").src =
      user.photoURL || "https://www.gravatar.com/avatar/?d=mp";

    $("userAvatar").alt = `Foto de ${name}`;
  }

  $("identity").textContent = "";

  $("app").classList.add("hidden");
  $("admin").classList.add("hidden");
  $("viewTabs").classList.add("hidden");
  $("homeView").classList.remove("hidden");

  if (stopClaims) {
    stopClaims();
    stopClaims = null;
  }

  currentClaims = [];

  if (!user) {
    document.body.classList.remove("voted");
    $("receipt").classList.add("hidden");
    showMessage("Entre com sua conta Google para participar.");
    revealPage();
    return;
  }

  try {
    const admin = isAdmin(userEmail());

    const alreadyVoted = await loadReservation();
    const welcome = currentUser.displayName || currentUser.email || "";

    if (alreadyVoted) {
      $("app").classList.add("hidden");
      showWelcome(welcome, "Sua presença já está confirmada.", true);
    } else {
      $("app").classList.remove("hidden");
      showWelcome(welcome, "");
    }

    if (admin) {
      $("viewTabs").classList.remove("hidden");
      setView(alreadyVoted ? "admin" : "home");
      $("backToReceipt").classList.toggle("hidden", !alreadyVoted);
    } else if (alreadyVoted) {
      showReceipt();
      revealPage();
      return;
    }

    revealPage();

    stopClaims = onSnapshot(
      collection(db, "claims"),
      snapshot => {
        currentClaims = snapshot.docs.map(d => ({
          uid: d.id,
          ...d.data()
        }));

        renderItems();

        if (isAdmin(userEmail())) {
          loadAdmin().catch(console.error);
        }
      },
      error => {
        console.error(error);
        showMessage(
          "Não foi possível carregar as opções. Verifique as regras do Firestore."
        );
      }
    );

    if (admin) {
      await loadAdmin();
    }
  } catch (error) {
    console.error(error);
    showMessage(
      "Não foi possível carregar sua inscrição. Confira as regras do Firestore."
    );
    revealPage();
  }
});

// Renderização dos itens
function renderItems() {
  const select = $("item");
  const previous = select.value;

  const myClaim = currentClaims.find(
    claim => claim.uid === currentUser?.uid
  );

  const myItemId = myClaim?.itemId || "";

  select.innerHTML = '<option value="">Selecione um item</option>';

  const groups = {};

  ITEMS.forEach(item => {
    const claimed = currentClaims.filter(
      claim => claim.itemId === item.id
    ).length;

    const remaining = item.capacity - claimed;

    if (remaining <= 0 && myItemId !== item.id) return;

    (groups[item.category] ||= []).push({
      ...item,
      remaining: Math.max(0, remaining)
    });
  });

  Object.entries(groups).forEach(([category, rows]) => {
    const group = document.createElement("optgroup");
    group.label = category;

    rows.forEach(item => {
      const option = document.createElement("option");

      option.value = item.id;
      option.textContent = item.remaining > 0
        ? `${item.name} — ${item.remaining} vaga(s)`
        : `${item.name} — sua escolha`;

      group.append(option);
    });

    select.append(group);
  });

  if ([...select.options].some(option => option.value === previous)) {
    select.value = previous;
  } else if (myItemId) {
    select.value = myItemId;
  }

  select.disabled = !$("attending").checked;
}

// Carrega inscrição

async function loadReservation() {
  const ref = doc(db, "reservations", currentUser.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    $("reservation").reset();
    $("attending").checked = true;
    $("item").disabled = false;
    return false;
  }

  const reservation = snap.data();

  $("name").value = reservation.name || "";

  // O usuário já votou. Não libera uma nova inscrição.
  $("receiptName").textContent = reservation.name || "";
  $("receiptItem").textContent =
    itemById(reservation.itemId)?.name || "Sem contribuição";

  return true;
}

let sheetTimer = 0;

function showReceipt() {
  const receipt = $("receipt");
  clearTimeout(sheetTimer);
  receipt.classList.remove("hidden", "is-closing");
  document.body.classList.add("voted");
  $("successModal").classList.add("hidden");
  const admin = isAdmin(userEmail());
  $("openAdmin").classList.toggle("hidden", !admin);
  $("backHome").classList.toggle("hidden", admin);
}

function closeSheet(after) {
  const receipt = $("receipt");
  if (receipt.classList.contains("hidden")) {
    document.body.classList.remove("voted");
    after?.();
    return;
  }
  receipt.classList.add("is-closing");
  clearTimeout(sheetTimer);
  sheetTimer = setTimeout(() => {
    receipt.classList.add("hidden");
    receipt.classList.remove("is-closing");
    document.body.classList.remove("voted");
    after?.();
  }, 280);
}

function backToHome() {
  closeSheet(() => {
    $("app").classList.add("hidden");
    showWelcome(
      currentUser?.displayName || currentUser?.email || "",
      "Sua presença já está confirmada.",
      true
    );
    if (isAdmin(userEmail())) {
      $("viewTabs").classList.remove("hidden");
      setView("home");
    }
    window.scrollTo(0, 0);
  });
}

function openAdminPanel() {
  if (!isAdmin(userEmail())) return;

  closeSheet(() => {
    $("app").classList.add("hidden");
    $("viewTabs").classList.remove("hidden");
    $("backToReceipt").classList.remove("hidden");
    showWelcome(
      currentUser?.displayName || currentUser?.email || "",
      "Sua presença já está confirmada.",
      true
    );
    setView("admin");
    window.scrollTo(0, 0);
  });
}

$("showReceipt").onclick = showReceipt;
$("openVoucher").onclick = showReceipt;
$("closeSheet").onclick = () => closeSheet();
$("backHome").onclick = backToHome;
$("openAdmin").onclick = openAdminPanel;
$("backToReceipt").onclick = showReceipt;
$("tabHome").onclick = () => setView("home");
$("tabAdmin").onclick = () => {
  if (isAdmin(userEmail())) setView("admin");
};


$("attending").onchange = () => {
  $("item").disabled = !$("attending").checked;
};

// Salva inscrição
$("reservation").onsubmit = async event => {
  event.preventDefault();

  if (!currentUser) return;

  const button = $("reservation").querySelector(
    'button[type="submit"]'
  );

  setBusy(button, true, "Salvando...");

  try {
    const name = $("name").value.trim().slice(0, 90);
    const attending = $("attending").checked;
    const itemId = attending ? $("item").value : "";

    if (!name) {
      throw new Error("Informe seu nome.");
    }

    if (attending && !itemById(itemId)) {
      throw new Error("Escolha um item válido para levar.");
    }

    const reservationRef = doc(db, "reservations", currentUser.uid);
    const claimRef = doc(db, "claims", currentUser.uid);

    const claimsSnapshot = await getDocs(collection(db, "claims"));


    await runTransaction(db, async transaction => {
      const reservationSnap = await transaction.get(reservationRef);
      const claimSnap = await transaction.get(claimRef);

      // Impede uma segunda inscrição
      if (reservationSnap.exists() || claimSnap.exists()) {
        throw new Error("Sua inscrição já foi realizada. Não é possível votar novamente.");
      }

      if (attending) {
        const claimedByOthers = claimsSnapshot.docs.filter(d =>
          d.id !== currentUser.uid &&
          d.data().itemId === itemId
        ).length;

        const selectedItem = itemById(itemId);

        if (claimedByOthers >= selectedItem.capacity) {
          throw new Error("Esse item atingiu o limite. Escolha outro.");
        }

        transaction.set(claimRef, {
          uid: currentUser.uid,
          itemId
        });
      }

      transaction.set(reservationRef, {
        uid: currentUser.uid,
        email: userEmail(),
        name,
        attending,
        itemId: attending ? itemId : null,
        createdAt: serverTimestamp()
      });
    });


    $("receiptName").textContent = name;
    $("receiptItem").textContent = itemById(itemId)?.name || "";

    $("successModal").classList.remove("hidden");

    await loadReservation();

    if (isAdmin(userEmail())) {
      await loadAdmin();
    }
  } catch (error) {
    console.error(error);
    alert(error.message || "Não foi possível salvar sua participação.");
  } finally {
    setBusy(button, false);
  }
};


// Painel administrativo
async function loadAdmin() {
  if (!isAdmin(userEmail())) return;

  const [reservationsSnap, claimsSnap] = await Promise.all([
    getDocs(collection(db, "reservations")),
    getDocs(collection(db, "claims"))
  ]);

  const people = reservationsSnap.docs.map(d => d.data());
  const claims = claimsSnap.docs.map(d => d.data());
  adminReport = buildReport(people, claims);

  const confirmed = people.filter(person => person.attending);
  const totalPeople = confirmed.length;

  $("stats").innerHTML = `
    <div class="stat">
      <b>${confirmed.length}</b>
      <span>Confirmados</span>
    </div>

    <div class="stat">
      <b>${totalPeople}</b>
      <span>Pessoas</span>
    </div>

    <div class="stat">
      <b>${ITEMS.filter(item =>
    claims.filter(claim => claim.itemId === item.id).length < item.capacity
  ).length}</b>
      <span>Itens livres</span>
    </div>
  `;

  $("inventory").innerHTML = ITEMS.map(item => {
    const claimed = claims.filter(
      claim => claim.itemId === item.id
    ).length;
    const pct = Math.min(100, Math.round((claimed / item.capacity) * 100));
    const full = claimed >= item.capacity;

    return `
      <div class="item-row${full ? " is-full" : ""}">
        <div class="item-copy">
          <span class="item-title">${esc(item.name)}</span>
          <span class="muted">${esc(item.category)}</span>
          <span class="meter" aria-hidden="true"><span style="width:${pct}%"></span></span>
        </div>
        <strong>${claimed}<span>/${item.capacity}</span></strong>
      </div>
    `;
  }).join("");

  $("attendees").innerHTML = people.map(person => `
    <div class="person">
      <div class="person-copy">
        <span class="person-name">${esc(person.name)}</span>
        <span class="muted">${esc(person.email)}</span>
        <span class="muted">${esc(itemById(person.itemId)?.name || "Sem item")}</span>
      </div>
      <span class="status ${person.attending ? "is-yes" : "is-no"}">${person.attending ? "Confirmado" : "Não irá"}</span>
    </div>
  `).join("") || '<p class="muted">Ainda não há inscrições.</p>';
}

function esc(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

// Atualizar painel
$("refresh").onclick = () => {
  loadAdmin().catch(error => {
    console.error(error);
    alert("Não foi possível atualizar o painel.");
  });
};

const EVENT_ADDRESS = "R. Francisco Tapajós, 359 - Vila da Saúde";
const encodedAddress = encodeURIComponent(EVENT_ADDRESS);

function closeHistory() {
  $("history").classList.add("hidden");
  document.body.classList.remove("is-history");
}

async function openHistory() {
  if (!currentUser) return;

  $("userDropdown").classList.add("hidden");
  $("historyList").innerHTML = '<p class="history-empty">Carregando...</p>';
  $("history").classList.remove("hidden");
  document.body.classList.add("is-history");

  const snap = await getDoc(doc(db, "reservations", currentUser.uid));

  if (!snap.exists()) {
    $("historyList").innerHTML = '<p class="history-empty">Você ainda não confirmou presença em um churrasco.</p>';
    return;
  }

  const data = snap.data();
  const brought = data.attending
    ? itemById(data.itemId)?.name || "Sem item"
    : "Não participou";

  $("historyList").innerHTML = `
    <article class="history-card">
      <p class="history-date">12 de dezembro de 2026</p>
      <h2>Open House BBQ</h2>
      <dl>
        <div><dt>Horário</dt><dd>13:00</dd></div>
        <div><dt>Local</dt><dd>Salão de festa</dd></div>
        <div><dt>Endereço</dt><dd>${esc(EVENT_ADDRESS)}</dd></div>
        <div><dt>Você levou</dt><dd>${esc(brought)}</dd></div>
      </dl>
    </article>
  `;
}

$("uberLink").href =
  `https://m.uber.com/ul/?action=setPickup&dropoff[formatted_address]=${encodedAddress}`;

$("wazeLink").href =
  `https://waze.com/ul?q=${encodedAddress}&navigate=yes`;

async function copyAddress(button) {
  try {
    await navigator.clipboard.writeText(EVENT_ADDRESS);
    button.classList.add("is-copied");
    clearTimeout(button._copiedTimer);
    button._copiedTimer = setTimeout(() => {
      button.classList.remove("is-copied");
    }, 1800);
  } catch (error) {
    button.classList.remove("is-copied");
    alert("Não foi possível copiar. Selecione o endereço manualmente.");
  }
}

$("copyAddress").addEventListener("click", () => copyAddress($("copyAddress")));
$("copyEventAddress").addEventListener("click", () => copyAddress($("copyEventAddress")));

let adminReport = null;

function buildReport(people, claims) {
  const confirmed = people.filter(person => person.attending);
  const totalPeople = confirmed.length;
  const items = ITEMS.map(item => {
    const claimed = claims.filter(claim => claim.itemId === item.id).length;
    return {
      name: item.name,
      claimed,
      capacity: item.capacity,
      pct: Math.min(100, Math.round((claimed / item.capacity) * 100))
    };
  });

  return {
    confirmedCount: confirmed.length,
    totalPeople,
    openItems: items.filter(item => item.claimed < item.capacity).length,
    items,
    people: confirmed.map(person => ({
      name: person.name || "Sem nome",
      email: person.email || "",
      item: itemById(person.itemId)?.name || "Sem item"
    }))
  };
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function canvasFont(weight, size) {
  const safe = weight >= 700 ? 700 : weight >= 600 ? 600 : weight >= 500 ? 500 : 400;
  return `${safe} ${size}px Inter, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
}

function fitText(ctx, text, maxWidth) {
  const value = String(text || "");
  if (ctx.measureText(value).width <= maxWidth) return value;
  let cut = value;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

function downloadCanvas(canvas, filename) {
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = filename;
  link.click();
}

function makeCanvas(width, height) {
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.textBaseline = "top";
  return { canvas, ctx };
}

async function paintWhenReady() {
  await document.fonts.load(canvasFont(600, 32));
  await document.fonts.ready;
}

function drawReport(report) {
  const width = 1080;
  const pad = 56;
  const inner = width - pad * 2;
  const rowH = 86;
  const personH = 124;
  const height = 560 + report.items.length * rowH + Math.max(report.people.length, 1) * personH;
  const { canvas, ctx } = makeCanvas(width, height);

  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#ff7a3c";
  ctx.font = canvasFont(650, 18);
  ctx.fillText("OPEN HOUSE BBQ", pad, 52);

  ctx.fillStyle = "#f5f5f7";
  ctx.font = canvasFont(600, 52);
  ctx.fillText("Confirmados", pad, 84);

  ctx.fillStyle = "#98989f";
  ctx.font = canvasFont(500, 22);
  ctx.fillText("12 de dezembro de 2026 · 13:00 · Salão de festa", pad, 152);

  const stats = [
    [String(report.confirmedCount), "Confirmados"],
    [String(report.totalPeople), "Pessoas"],
    [String(report.openItems), "Itens livres"]
  ];
  const gap = 16;
  const boxW = (inner - gap * 2) / 3;
  stats.forEach(([value, label], index) => {
    const x = pad + index * (boxW + gap);
    const y = 210;
    ctx.fillStyle = "#141416";
    roundedRect(ctx, x, y, boxW, 110, 18);
    ctx.fill();
    ctx.fillStyle = "#f5f5f7";
    ctx.font = canvasFont(600, 40);
    ctx.fillText(value, x + 22, y + 18);
    ctx.fillStyle = "#98989f";
    ctx.font = canvasFont(500, 18);
    ctx.fillText(label, x + 22, y + 68);
  });

  let y = 360;
  ctx.fillStyle = "#f5f5f7";
  ctx.font = canvasFont(600, 26);
  ctx.fillText("Itens", pad, y);
  y += 46;

  report.items.forEach(item => {
    ctx.fillStyle = "#141416";
    roundedRect(ctx, pad, y, inner, 74, 16);
    ctx.fill();
    ctx.fillStyle = "#f5f5f7";
    ctx.font = canvasFont(600, 22);
    ctx.fillText(fitText(ctx, item.name, inner - 140), pad + 20, y + 14);
    const count = `${item.claimed}/${item.capacity}`;
    ctx.fillStyle = "#98989f";
    ctx.font = canvasFont(600, 20);
    const countW = ctx.measureText(count).width;
    ctx.fillText(count, pad + inner - 20 - countW, y + 16);

    const barX = pad + 20;
    const barY = y + 48;
    const barW = inner - 40;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundedRect(ctx, barX, barY, barW, 8, 4);
    ctx.fill();
    const fillW = Math.max(item.pct > 0 ? 8 : 0, barW * item.pct / 100);
    ctx.fillStyle = item.claimed >= item.capacity ? "#ff6961" : "#ff7a3c";
    if (fillW) {
      roundedRect(ctx, barX, barY, Math.min(barW, fillW), 8, 4);
      ctx.fill();
    }
    y += rowH;
  });

  y += 18;
  ctx.fillStyle = "#f5f5f7";
  ctx.font = canvasFont(600, 26);
  ctx.fillText("Quem confirmou", pad, y);
  y += 46;

  if (!report.people.length) {
    ctx.fillStyle = "#98989f";
    ctx.font = canvasFont(500, 20);
    ctx.fillText("Ainda não há confirmações.", pad, y);
  }

  report.people.forEach(person => {
    const cardH = 108;
    ctx.fillStyle = "#141416";
    roundedRect(ctx, pad, y, inner, cardH, 18);
    ctx.fill();

    ctx.font = canvasFont(650, 16);
    const badge = "Confirmado";
    const badgeW = ctx.measureText(badge).width + 28;
    const badgeH = 32;
    const badgeX = pad + inner - 18 - badgeW;
    const badgeY = y + (cardH - badgeH) / 2;
    ctx.fillStyle = "rgba(48, 209, 88, 0.16)";
    roundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 16);
    ctx.fill();
    ctx.fillStyle = "#30d158";
    ctx.fillText(badge, badgeX + 14, badgeY + 8);

    const textW = badgeX - pad - 36;
    ctx.fillStyle = "#f5f5f7";
    ctx.font = canvasFont(600, 24);
    ctx.fillText(fitText(ctx, person.name, textW), pad + 20, y + 16);
    ctx.fillStyle = "#98989f";
    ctx.font = canvasFont(500, 16);
    ctx.fillText(fitText(ctx, person.email, textW), pad + 20, y + 48);
    ctx.fillText(fitText(ctx, person.item, textW), pad + 20, y + 72);
    y += personH;
  });

  return canvas;
}

function drawVoucher(name, item) {
  const width = 900;
  const height = 900;
  const { canvas, ctx } = makeCanvas(width, height);

  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#141416";
  roundedRect(ctx, 48, 48, width - 96, height - 96, 36);
  ctx.fill();

  const cx = width / 2;
  ctx.beginPath();
  ctx.fillStyle = "rgba(48, 209, 88, 0.16)";
  ctx.arc(cx, 140, 36, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#30d158";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(cx - 14, 140);
  ctx.lineTo(cx - 4, 152);
  ctx.lineTo(cx + 16, 128);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = "#ff7a3c";
  ctx.font = canvasFont(650, 18);
  ctx.fillText("OPEN HOUSE BBQ", cx, 196);
  ctx.fillStyle = "#f5f5f7";
  ctx.font = canvasFont(600, 48);
  ctx.fillText("Presença confirmada!", cx, 232);
  ctx.fillStyle = "#98989f";
  ctx.font = canvasFont(500, 22);
  ctx.fillText("Estamos esperando por você.", cx, 296);

  ctx.textAlign = "left";
  const left = 96;
  const right = width - 96;
  let y = 360;
  const line = () => {
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    y += 28;
  };
  const label = text => {
    ctx.fillStyle = "#6e6e73";
    ctx.font = canvasFont(650, 14);
    ctx.fillText(text, left, y);
    y += 28;
  };
  const value = text => {
    ctx.fillStyle = "#f5f5f7";
    ctx.font = canvasFont(600, 32);
    ctx.fillText(fitText(ctx, text || "—", right - left), left, y);
    y += 48;
  };

  line();
  label("SEU NOME");
  value(name);
  line();
  label("SUA CONTRIBUIÇÃO");
  value(item);
  line();

  const cols = [
    ["DATA", "12/12/2026"],
    ["HORÁRIO", "13:00"],
    ["LOCAL", "Salão de festa"]
  ];
  const colW = (right - left) / 3;
  cols.forEach(([title, text], index) => {
    const x = left + colW * index;
    ctx.fillStyle = "#6e6e73";
    ctx.font = canvasFont(650, 14);
    ctx.fillText(title, x, y);
    ctx.fillStyle = "#f5f5f7";
    ctx.font = canvasFont(600, 22);
    ctx.fillText(text, x, y + 28);
  });
  y += 78;
  line();
  label("ENDEREÇO");
  ctx.fillStyle = "#f5f5f7";
  ctx.font = canvasFont(500, 24);
  ctx.fillText("R. Francisco Tapajós, 359", left, y);
  y += 34;
  ctx.fillText("Vila da Saúde", left, y);

  return canvas;
}

function fileSlug(value) {
  return String(value || "convidado")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "convidado";
}

$("exportAdmin").onclick = async () => {
  if (!isAdmin(userEmail())) return;
  const button = $("exportAdmin");
  setBusy(button, true, "Gerando...");
  try {
    await loadAdmin();
    if (!adminReport) throw new Error("Sem dados para exportar.");
    await paintWhenReady();
    downloadCanvas(drawReport(adminReport), "open-house-bbq-confirmados.png");
  } catch (error) {
    console.error(error);
    alert("Não foi possível gerar a imagem.");
  } finally {
    setBusy(button, false);
  }
};

$("downloadVoucher").onclick = async () => {
  const button = $("downloadVoucher");
  setBusy(button, true, "Gerando...");
  try {
    await paintWhenReady();
    const name = $("receiptName").textContent.trim() || "Convidado";
    const item = $("receiptItem").textContent.trim() || "Sem contribuição";
    downloadCanvas(drawVoucher(name, item), `voucher-${fileSlug(name)}.png`);
  } catch (error) {
    console.error(error);
    alert("Não foi possível baixar o voucher.");
  } finally {
    setBusy(button, false);
  }
};