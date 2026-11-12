
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // Usuário autenticado pelo Firebase.
    function signedIn() {
      return request.auth != null;
    }

    // Administrador.
    function isAdmin() {
      return signedIn()
        && request.auth.token.email == "pedro.ruffo.dev@gmail.com";
    }

    // Itens permitidos.
    function validItem(id) {
      return id in [
        "carne-bovina",
        "linguica",
        "frango",
        "pao-alho",
        "queijo"
      ];
    }

    // Caminhos dos documentos.
    function reservationPath(uid) {
      return /databases/$(database)/documents/reservations/$(uid);
    }

    function claimPath(uid) {
      return /databases/$(database)/documents/claims/$(uid);
    }

    // Confere se a inscrição e a contribuição
    // estão sendo criadas juntas.
    function reservationMatchesClaim(uid, itemId) {
      return existsAfter(reservationPath(uid))
        && getAfter(reservationPath(uid)).data.uid == uid
        && getAfter(reservationPath(uid)).data.attending == true
        && getAfter(reservationPath(uid)).data.itemId == itemId;
    }

    // LISTA DE AUTORIZAÇÃO ANTIGA
    // Não é mais utilizada.
    match /allowlist/{email} {
      allow read, write: if false;
    }

    // INSCRIÇÕES
    match /reservations/{uid} {

      // Cada usuário vê sua própria inscrição.
      // Administrador pode consultar todas.
      allow get: if signedIn()
        && (
          isAdmin()
          || request.auth.uid == uid
        );

      allow list: if isAdmin();

      // Somente criação.
      // Se já existe uma inscrição, não pode criar outra.
      allow create: if signedIn()
        && request.auth.uid == uid
        && !exists(reservationPath(uid))
        && request.resource.data.keys().hasOnly([
          "uid",
          "email",
          "name",
          "attending",
          "itemId",
          "createdAt"
        ])
        && request.resource.data.uid == uid
        && request.resource.data.email == request.auth.token.email
        && request.resource.data.name is string
        && request.resource.data.name.size() > 0
        && request.resource.data.name.size() <= 90
        && request.resource.data.attending is bool
        && (
          (
            request.resource.data.attending == true
            && validItem(request.resource.data.itemId)
            && existsAfter(claimPath(uid))
            && getAfter(claimPath(uid)).data.uid == uid
            && getAfter(claimPath(uid)).data.itemId
              == request.resource.data.itemId
          )
          ||
          (
            request.resource.data.attending == false
            && request.resource.data.itemId == null
            && !existsAfter(claimPath(uid))
          )
        );

      // Não pode editar nem excluir.
      allow update, delete: if false;
    }

    // CONTRIBUIÇÕES
    match /claims/{uid} {

      // Usuários autenticados podem consultar
      // as contribuições para visualizar as vagas.
      allow read: if signedIn();

      // Somente o próprio usuário pode criar
      // sua contribuição, junto com a inscrição.
      allow create: if signedIn()
        && request.auth.uid == uid
        && !exists(claimPath(uid))
        && !exists(reservationPath(uid))
        && request.resource.data.keys().hasOnly([
          "uid",
          "itemId",
          "createdAt"
        ])
        && request.resource.data.uid == uid
        && validItem(request.resource.data.itemId)
        && reservationMatchesClaim(
          uid,
          request.resource.data.itemId
        );

      // Não pode alterar nem excluir.
      allow update, delete: if false;
    }

    // ITENS
    match /items/{itemId} {
      allow read, write: if false;
    }

    // DADOS ADMINISTRATIVOS
    match /adminData/{docId} {
      allow read, write: if false;
    }
  }
}
