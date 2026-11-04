LeetCode Daily Lock - friends dashboard

A small website where you and your friends see each other's streaks. Each
person's extension sends its stats here. ngrok puts it online at your domain.

1. Install Node.js 18 or newer.
2. Copy .env.example to .env in this folder and fill in NGROK_AUTHTOKEN and
   NGROK_DOMAIN (from dashboard.ngrok.com). Never share or commit .env.
3. In this folder run:   npm install
4. Make a login for yourself and each friend. The username is the first name.
   Easiest: put them in .env (passwords can't contain commas):
     DASHBOARD_USERS=Jacob:mypassword,Sam:samspassword
   That line is the whole list; it's applied each time the dashboard starts.
   Or leave it empty and use the commands instead:
     npm run add-user -- Jacob mypassword
     npm run add-user -- Sam               (makes up a password and prints it)
   Run it again with the same name to change a password.
   npm run users lists everyone; npm run remove-user -- Sam deletes Sam.
5. Start it:             npm start
   Leave the window open. Everyone opens https://<NGROK_DOMAIN>.

Start with Windows (no window, runs in the background):
     npm run autostart
   It starts now and every time you sign in. Output goes to data\dashboard.log.
   Turn it off with:     npm run autostart -- --off

In the extension settings, under "Practice with friends", everyone enters their
first name, their password and https://<NGROK_DOMAIN>, then clicks Sync now.
They log in to the dashboard page with the same name and password.

Passwords are stored as hashes in data/users.json along with everyone's stats.
The dashboard is only online while your PC is on and it's running.

npm run local   runs it on this computer only (http://localhost:8787).
