const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineString } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();
const ADMIN_EMAILS = defineString("ADMIN_EMAILS");

function emailOf(req) {
  if (!req.auth || !req.auth.token.email) {
    throw new HttpsError("unauthenticated", "Entre com sua conta Google.");
  }
  return String(req.auth.token.email).trim().toLowerCase();
}
function admins() {
  return ADMIN_EMAILS.value().split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
}
function isAdmin(email) { return admins().includes(email); }

async function assertAllowed(email) {
  const snap = await db.doc(`allowlist/${email}`).get();
  if (!snap.exists && !isAdmin(email)) {
    throw new HttpsError("permission-denied", "Este e-mail não está na lista de convidados.");
  }
}
async function assertAdmin(email) {
  if (!isAdmin(email)) throw new HttpsError("permission-denied", "Apenas administradores.");
}

exports.bootstrap = onCall(async req => {
  const email = emailOf(req);
  await assertAdmin(email);
  const defaults = [
    ["picanha", "Picanha / carne bovina", "Carnes", 5],
    ["linguica", "Linguiça", "Carnes", 4],
    ["coracao", "Coração de frango", "Carnes", 3],
    ["frango", "Frango", "Carnes", 4],
    ["costela", "Costela", "Carnes", 2],
    ["pao-alho", "Pão de alho", "Acompanhamentos", 4],
    ["queijo", "Queijo coalho", "Acompanhamentos", 3],
  ];
  const batch = db.batch();
  for (const [id, name, category, capacity] of defaults) {
    const ref = db.doc(`items/${id}`);
    batch.set(ref, { name, category, capacity, active: true }, { merge: true });
  }
  await batch.commit();
  return { ok: true, count: defaults.length };
});

exports.addGuest = onCall(async req => {
  const email = emailOf(req);
  await assertAdmin(email);
  const target = String(req.data.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
    throw new HttpsError("invalid-argument", "Informe um e-mail válido.");
  }
  await db.doc(`allowlist/${target}`).set({
    email: target, addedAt: FieldValue.serverTimestamp(), addedBy: email
  });
  return { ok: true };
});

exports.removeGuest = onCall(async req => {
  const email = emailOf(req);
  await assertAdmin(email);
  const target = String(req.data.email || "").trim().toLowerCase();
  if (isAdmin(target)) throw new HttpsError("failed-precondition", "Não remova um administrador.");
  await db.doc(`allowlist/${target}`).delete();
  return { ok: true };
});

exports.saveReservation = onCall(async req => {
  const email = emailOf(req);
  await assertAllowed(email);
  const name = String(req.data.name || "").trim().slice(0, 90);
  const attending = req.data.attending === true;
  const guests = Math.max(0, Math.min(10, Number(req.data.guests || 0)));
  const itemId = attending ? String(req.data.itemId || "") : "";
  if (!name) throw new HttpsError("invalid-argument", "Informe seu nome.");
  if (attending && !itemId) throw new HttpsError("invalid-argument", "Escolha um item para levar.");
  const reservationRef = db.doc(`reservations/${req.auth.uid}`);
  await db.runTransaction(async tx => {
    const oldSnap = await tx.get(reservationRef);
    const old = oldSnap.exists ? oldSnap.data() : null;
    const newItemRef = itemId ? db.doc(`items/${itemId}`) : null;
    const oldItemRef = old && old.itemId ? db.doc(`items/${old.itemId}`) : null;
    const refs = [...new Set([newItemRef, oldItemRef].filter(Boolean).map(r => r.path))].map(p => db.doc(p));
    const itemSnaps = {};
    for (const ref of refs) itemSnaps[ref.id] = await tx.get(ref);

    if (itemId && (!itemSnaps[itemId] || !itemSnaps[itemId].exists)) {
      throw new HttpsError("not-found", "Esse item não está disponível.");
    }
    if (itemId) {
      const item = itemSnaps[itemId].data();
      const current = Number(item.claimed || 0);
      const releasingSame = old && old.itemId === itemId ? 1 : 0;
      if (!item.active || current - releasingSame >= Number(item.capacity)) {
        throw new HttpsError("resource-exhausted", "Esse item acabou de atingir o limite. Escolha outro.");
      }
    }
    if (old && old.itemId && old.itemId !== itemId) {
      const oldData = itemSnaps[old.itemId] && itemSnaps[old.itemId].data();
      if (oldData) tx.update(oldItemRef, { claimed: Math.max(0, Number(oldData.claimed || 0) - 1) });
    }
    if (itemId && (!old || old.itemId !== itemId)) {
      tx.update(newItemRef, { claimed: Number(itemSnaps[itemId].data().claimed || 0) + 1 });
    }
    tx.set(reservationRef, {
      uid: req.auth.uid, email, name, attending, guests,
      itemId: itemId || null, updatedAt: FieldValue.serverTimestamp()
    });
  });
  return { ok: true };
});

exports.cancelReservation = onCall(async req => {
  const email = emailOf(req);
  await assertAllowed(email);
  const ref = db.doc(`reservations/${req.auth.uid}`);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data();
    if (data.itemId) {
      const itemRef = db.doc(`items/${data.itemId}`);
      const itemSnap = await tx.get(itemRef);
      if (itemSnap.exists) tx.update(itemRef, { claimed: Math.max(0, Number(itemSnap.data().claimed || 0) - 1) });
    }
    tx.delete(ref);
  });
  return { ok: true };
});

exports.adminUpdateItem = onCall(async req => {
  const email = emailOf(req);
  await assertAdmin(email);
  const id = String(req.data.id || "");
  const capacity = Number(req.data.capacity);
  const active = req.data.active !== false;
  if (!/^[a-z0-9-]+$/.test(id) || !Number.isInteger(capacity) || capacity < 0 || capacity > 500) {
    throw new HttpsError("invalid-argument", "Item ou limite inválido.");
  }
  const ref = db.doc(`items/${id}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Item não encontrado.");
  if (capacity < Number(snap.data().claimed || 0)) {
    throw new HttpsError("failed-precondition", "O limite não pode ser menor que as reservas atuais.");
  }
  await ref.update({ capacity, active });
  return { ok: true };
});

exports.adminDashboard = onCall(async req => {
  const email = emailOf(req);
  await assertAdmin(email);
  const [itemsSnap, reservationsSnap] = await Promise.all([
    db.collection("items").get(), db.collection("reservations").get()
  ]);
  return {
    items: itemsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    reservations: reservationsSnap.docs.map(d => d.data())
  };
});
