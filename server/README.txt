LeetCode Daily Lock - friends dashboard

A small website where you and your friends see each other's streaks. Each
person's extension sends its stats here. ngrok puts it online at your domain.

1. Install Node.js 18 or newer.
2. Copy .env.example to .env in this folder and fill in NGROK_AUTHTOKEN and
   NGROK_DOMAIN (from dashboard.ngrok.com). Never share or commit .env.
3. In this folder run:   npm install
   then:                 npm start
4. Leave the window open. Your friends and you open https://<NGROK_DOMAIN>.

In the extension settings, under "Practice with friends", everyone enters their
first name and https://<NGROK_DOMAIN>, then clicks Sync now.

The first name is the only "login". The first browser to use a name owns it,
so a friend can't post as you, but anyone with the link can view the page.
Stats are saved in data/users.json. To remove someone, stop the dashboard,
delete their entry from that file, and start it again.

npm run local   runs it on this computer only (http://localhost:8787).
