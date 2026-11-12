import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";

// 1) Substitua pelos dados do seu projeto Firebase (Configurações > Seus apps > Web).
const firebaseConfig = {
  apiKey: "AIzaSyCSj__eG6LftnnxxJD7SvJ2Up_-Si_tP9o",
  authDomain: "open-house-bbq.firebaseapp.com",
  projectId: "open-house-bbq",
  storageBucket: "open-house-bbq.firebasestorage.app",
  messagingSenderId: "78187718949",
  appId: "1:78187718949:web:23992e6e9c47b57f8212cc",
  measurementId: "G-H79Y057H79"
};

const ADMIN_EMAILS = ["pedro.ruffo.dev@gmail.com"].map(x => x.toLowerCase());

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);
const call = name => httpsCallable(functions, name);
const $ = id => document.getElementById(id);
let currentUser = null, stopItems = null;

$("login").onclick = async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch(e) { alert(e.message); }
};
onAuthStateChanged(auth, async user => {
  currentUser = user;
  $("login").textContent = user ? "Sair" : "Entrar com Google";
  $("login").onclick = user ? () => signOut(auth) : async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch(e) { alert(e.message); }
  };
  $("identity").textContent = user ? `Conectado como ${user.email}` : "";
  $("app").classList.add("hidden"); $("admin").classList.add("hidden");
  if (stopItems) stopItems();
  if (!user) { $("notice").textContent = "Entre com sua conta Google autorizada para participar."; return; }
  try {
    const allowed = ADMIN_EMAILS.includes(user.email.toLowerCase()) ||
      (await getDoc(doc(db, "allowlist", user.email.toLowerCase()))).exists();
    if (!allowed) { $("notice").textContent = `O e-mail ${user.email} ainda não foi autorizado pelo organizador.`; return; }
    $("notice").textContent = "Acesso autorizado. Escolha sua contribuição abaixo.";
    $("app").classList.remove("hidden");
    await loadReservation();
    stopItems = onSnapshot(collection(db, "items"), snap => renderItems(snap.docs.map(d=>({id:d.id,...d.data()}))));
    if (ADMIN_EMAILS.includes(user.email.toLowerCase())) {
      $("admin").classList.remove("hidden"); await loadAdmin();
    }
  } catch(e) { $("notice").textContent = "Não foi possível validar seu acesso. Confira a configuração do Firebase."; console.error(e); }
});

function renderItems(items) {
  const select = $("item"), previous = select.value;
  select.innerHTML = '<option value="">Selecione um item</option>';
  const groups = {};
  items.filter(x=>x.active).forEach(x => {
    const remaining = Math.max(0, Number(x.capacity||0)-Number(x.claimed||0));
    if (remaining <= 0) return;
    (groups[x.category] ||= []).push({...x,remaining});
  });
  Object.entries(groups).forEach(([category, rows]) => {
    const group = document.createElement("optgroup"); group.label = category;
    rows.forEach(x => { const o=document.createElement("option");o.value=x.id;o.textContent=`${x.name} — ${x.remaining} vaga(s)`;group.append(o); });
    select.append(group);
  });
  if ([...select.options].some(o=>o.value===previous)) select.value=previous;
}
async function loadReservation() {
  const snap = await getDoc(doc(db,"reservations",currentUser.uid));
  if (!snap.exists()) return;
  const r=snap.data(); $("name").value=r.name||""; $("attending").checked=r.attending!==false;
  $("guests").value=r.guests||0; if(r.itemId) $("item").value=r.itemId;
}
$("attending").onchange = () => { $("item").disabled=!$("attending").checked; };
$("reservation").onsubmit = async e => {
  e.preventDefault();
  try {
    await call("saveReservation")({name:$("name").value,attending:$("attending").checked,guests:Number($("guests").value),itemId:$("attending").checked?$("item").value:""});
    alert("Participação salva com sucesso!"); await loadReservation(); await loadAdminIfVisible();
  } catch(err) { alert(err.message || "Não foi possível salvar. Atualize as opções e tente novamente."); }
};
$("cancel").onclick = async () => {
  if(!confirm("Deseja cancelar sua inscrição?")) return;
  try { await call("cancelReservation")({}); alert("Inscrição cancelada."); $("reservation").reset(); }
  catch(e){alert(e.message);}
};
async function loadAdminIfVisible(){if(!$("admin").classList.contains("hidden")) await loadAdmin();}
async function loadAdmin() {
  const data = (await call("adminDashboard")({})).data;
  const items=data.items, people=data.reservations;
  const confirmed=people.filter(p=>p.attending);
  $("stats").innerHTML=`<div class="stat"><b>${confirmed.length}</b><span>Inscrições confirmadas</span></div><div class="stat"><b>${confirmed.reduce((s,p)=>s+1+Number(p.guests||0),0)}</b><span>Pessoas no total</span></div><div class="stat"><b>${items.filter(i=>i.active&&i.claimed<i.capacity).length}</b><span>Itens com vagas</span></div>`;
  $("inventory").innerHTML=items.map(i=>`<div class="item-row"><span>${esc(i.name)} <span class="muted">(${esc(i.category)})</span></span><strong>${i.claimed||0}/${i.capacity}</strong></div>`).join("");
  $("attendees").innerHTML=people.map(p=>`<div class="person"><span>${esc(p.name)}<br><small class="muted">${esc(p.email)} · ${p.guests||0} acompanhante(s)</small></span><strong>${p.attending?"Confirmado":"Não irá"}</strong></div>`).join("")||"<p class='muted'>Ainda não há inscrições.</p>";
}
function esc(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
$("bootstrap").onclick=async()=>{try{await call("bootstrap")({});$("guestMessage").textContent="Lista inicial carregada.";await loadAdmin();}catch(e){$("guestMessage").textContent=e.message;}};
$("addGuest").onclick=async()=>{
  try{await call("addGuest")({email:$("guestEmail").value});$("guestMessage").textContent="Convidado autorizado."; $("guestEmail").value="";}
  catch(e){$("guestMessage").textContent=e.message;}
};
$("refresh").onclick=loadAdmin;
