![TerminalFart](https://cdn.jsdelivr.net/npm/terminalfart/assets/terminalfart-githero.png)

# TerminalFart

When your terminal fails, it rips one.

Install it once. After that, use your terminal normally. Failed commands keep the real error visible, then play a matching fart sound.

Works on bash, zsh, and PowerShell.

Restart your terminal after install.

## Install

```bash
npm install -g terminalfart
terminalfart install
```

Then run commands like normal:

```bash
npm test
npm run build
git push
bad-command
```

TerminalFart auto-detects your shell.

To choose a shell yourself:

```bash
terminalfart install bash
terminalfart install zsh
terminalfart install powershell
```

Check install status:

```bash
terminalfart status
```

Uninstall:

```bash
terminalfart uninstall
```

## Sounds

TerminalFart picks a sound based on what failed:

```txt
warning or lint failure     toot
test failure                dry
build failure               wet
command not found           poop-toot
git push reject             hellacious
```

Other failures use a default sound.

List the bundled sounds:

```bash
terminalfart --list-sounds
```

Turn on success sounds:

```bash
terminalfart config success on
```

Use TerminalFart for one command without turning on automatic mode:

```bash
terminalfart npm test
```

Choose a sound for one command:

```bash
terminalfart npm test --sound wet
terminalfart npm test --random
terminalfart npm test --mute
```
