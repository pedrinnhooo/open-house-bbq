# Open House BBQ — instalação

Aplicação web responsiva com Google Login, lista de convidados autorizados, limites de contribuições e painel administrativo.

## Importante antes de publicar
Este projeto é uma base funcional que precisa ser configurada no seu projeto Firebase. Não publique antes de substituir as configurações e revisar as regras. A lista de administradores fica configurada no parâmetro `ADMIN_EMAILS` das Cloud Functions.

## 1. Criar projeto Firebase
1. Acesse https://console.firebase.google.com/ e crie um projeto.
2. Adicione um aplicativo Web e copie a configuração Firebase.
3. Cole `apiKey`, `authDomain`, `projectId` e `appId` em `public/app.js`.
4. Em Authentication > Sign-in method, habilite Google.
5. Em Firestore Database, crie o banco em modo produção.
6. Adicione o domínio de hospedagem em Authentication > Settings > Authorized domains.

## 2. Configurar administrador
Edite `public/app.js` e substitua `pedro.ruffo.dev@gmail.com` pelo seu e-mail Google.
Ao implantar as funções, defina o mesmo e-mail no parâmetro `ADMIN_EMAILS`. Para mais de um administrador, separe por vírgula.

## 3. Instalar e implantar
Instale Node.js 20+, Firebase CLI e faça login:
```bash
npm install -g firebase-tools
firebase login
firebase use --add
cd functions && npm install && cd ..
firebase functions:params:set ADMIN_EMAILS
```
Quando solicitado, informe os e-mails administradores separados por vírgula.
Depois:
```bash
firebase deploy
```

## 4. Inicializar os itens
Entre no site com a conta administradora. Abra o console do navegador e execute:
```js
O painel administrativo possui o botão "Carregar lista inicial de itens". Clique nele uma vez.
```
Após inicializar, os itens aparecem no formulário. (A função `bootstrap` está incluída no backend e só administradores podem executá-la.)

## 5. Autorizar convidados
No painel, informe o e-mail Google do convidado e clique em Autorizar. Somente e-mails autorizados (e administradores) conseguem consultar e enviar inscrições.

## Como funciona o limite
A reserva é feita por Cloud Function usando transação Firestore. O contador de vagas e a inscrição são atualizados atomicamente. Duas pessoas tentando ocupar a última vaga não conseguem ultrapassar a capacidade.

## Observações de segurança
- As escritas diretas no Firestore estão bloqueadas pelas regras; o cliente usa Cloud Functions.
- Não compartilhe credenciais de conta de serviço.
- Para uso real, habilite faturamento do Firebase/Google Cloud se o plano exigir Cloud Functions.
- A lista de administradores no frontend controla apenas a exibição do painel; a autorização real é validada no backend por `ADMIN_EMAILS`.
- Os convidados visualizam apenas a própria inscrição. O painel administrativo obtém a visão geral por uma Cloud Function que valida o e-mail administrador no servidor.
