# LNZ Gestão

Sistema integrado de gestão para Discord com:

- Tickets com transcrição
- Cadastro de clientes
- Registro de vendas
- Controle de hospedagem e vencimento
- Renovação por botão/ticket
- Relatório mensal
- Avisos automáticos de vencimento
- Bot conectado em call 24h
- Site com login Discord
- Área administrativa e área exclusiva do cliente
- Logs administrativos

## Instalação local

1. Instale Node.js 20 ou superior.
2. Copie `.env.example` para `.env`.
3. Preencha as variáveis.
4. Rode:

```bash
npm install
npm start
```

Abra `http://localhost:8080`.

## OAuth2 no Discord Developer Portal

Em **OAuth2 > Redirects**, adicione:

`http://localhost:8080/auth/discord/callback`

Quando hospedar, troque para:

`https://SEU-DOMINIO/auth/discord/callback`

E ajuste `BASE_URL` no `.env`.

## Primeira configuração no Discord

Use `/configurar cargos` e `/configurar canais`.
Depois use `/painel-ticket` no canal onde os clientes abrirão tickets.

## Discloud

O projeto inclui `discloud.config`. Envie os arquivos para a Discloud e configure as variáveis de ambiente no painel. O arquivo `.env` não deve ser enviado publicamente.

## Segurança

Nunca compartilhe `DISCORD_TOKEN`, `CLIENT_SECRET` ou `SESSION_SECRET`.

## Transmissão de tela com som + chat

A versão 1.1 inclui uma sala em `/sala`:

- Administrador pode transmitir uma aba, janela ou tela.
- O navegador solicita `getDisplayMedia` com áudio, sem solicitar microfone.
- A prévia local fica muda para evitar retorno/eco.
- Clientes cadastrados podem assistir com áudio em tempo real.
- Chat de texto em tempo real na mesma sala.
- A sinalização do WebRTC e o chat usam Socket.IO.

> Para transmitir áudio, ao escolher o que compartilhar no Chrome/Edge, habilite **Compartilhar áudio** quando essa opção aparecer. O suporte a áudio de tela/janela depende do navegador e do sistema operacional.

Para atualizar uma instalação existente, rode `npm install` novamente para instalar a dependência `socket.io`.
