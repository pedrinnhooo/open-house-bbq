
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

function showMessage(message) {
  $("notice").textContent = message;
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

  $("identity").textContent = user
    ? `Conectado como ${user.email}`
    : "";

  $("app").classList.add("hidden");
  $("admin").classList.add("hidden");

  if (stopClaims) {
    stopClaims();
    stopClaims = null;
  }

  currentClaims = [];

  if (!user) {
    showMessage("Entre com sua conta Google para participar.");
    return;
  }

  try {
    const admin = isAdmin(userEmail());

    showMessage("Acesso autorizado! Escolha sua contribuição.");
    $("app").classList.remove("hidden");

    if (admin) {
      $("admin").classList.remove("hidden");
    }

    const alreadyVoted = await loadReservation();

    if (alreadyVoted) {
      showReceipt();
      return;
    }

    $("app").classList.remove("hidden");

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

function showReceipt() {
  document.body.classList.add("voted");
  $("receipt").classList.remove("hidden");
  $("successModal").classList.add("hidden");
}

$("showReceipt").onclick = showReceipt;


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

  const confirmed = people.filter(person => person.attending);

  const totalPeople = confirmed.reduce(
    (sum, person) => sum + 1 + Number(person.guests || 0),
    0
  );

  $("stats").innerHTML = `
    <div class="stat">
      <b>${confirmed.length}</b>
      <span>Inscrições confirmadas</span>
    </div>

    <div class="stat">
      <b>${totalPeople}</b>
      <span>Pessoas no total</span>
    </div>

    <div class="stat">
      <b>${ITEMS.filter(item =>
    claims.filter(claim => claim.itemId === item.id).length < item.capacity
  ).length}</b>
      <span>Itens com vagas</span>
    </div>
  `;

  $("inventory").innerHTML = ITEMS.map(item => {
    const claimed = claims.filter(
      claim => claim.itemId === item.id
    ).length;

    return `
      <div class="item-row">
        <span>
          ${esc(item.name)}
          <span class="muted">(${esc(item.category)})</span>
        </span>

        <strong>${claimed}/${item.capacity}</strong>
      </div>
    `;
  }).join("");

  $("attendees").innerHTML = people.map(person => `
    <div class="person">
      <span>
        ${esc(person.name)}
        <br>
        <small class="muted">
          ${esc(person.email)} ·
          ${Number(person.guests || 0)} acompanhante(s) ·
          ${esc(itemById(person.itemId)?.name || "Sem item")}
        </small>
      </span>

      <strong>
        ${person.attending ? "Confirmado" : "Não irá"}
      </strong>
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
