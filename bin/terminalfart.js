#!/usr/bin/env node
// Copyright 2026 Electric Wolfe Marshmallow Hypertext
// SPDX-License-Identifier: Apache-2.0

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const FAILURE_SOUND_DEFS = {
  dry: "dry fart",
  wet: "wet fart",
  toot: "little baby toot",
  "poop-toot": "cursed little poo toot",
  hellacious: "insane failure fart",
};

const EVENT_SOUND_DEFS = {
  success: "light success sound",
  "done-long": "gentle long task done sound",
  "needs-you": "attention sound",
};

const SOUND_DEFS = { ...FAILURE_SOUND_DEFS, ...EVENT_SOUND_DEFS };
const FAILURE_SOUND_NAMES = Object.keys(FAILURE_SOUND_DEFS);
const SOUND_NAMES = Object.keys(SOUND_DEFS);
const BLOCK_START = "# >>> terminalfart >>>";
const BLOCK_END = "# <<< terminalfart <<<";
const POWERSHELL_BLOCK_START = "# >>> terminalfart >>>";
const POWERSHELL_BLOCK_END = "# <<< terminalfart <<<";
const SUPPORTED_SHELLS = ["bash", "zsh", "powershell"];
const SUPPORTED_AGENTS = ["codex", "claude", "cursor", "hermes"];
const DEFAULT_COOLDOWN_MS = 30_000;
const LONG_TASK_DONE_MS = 120_000;
const AGENT_HOOK_TIMEOUT_SECONDS = 10;

function usage() {
  return [
    "Usage: terminalfart install [bash|zsh|powershell|codex|claude|cursor|hermes]",
    "       terminalfart uninstall [bash|zsh|powershell|codex|claude|cursor|hermes]",
    "       terminalfart status [bash|zsh|powershell|codex|claude|cursor|hermes]",
    "       terminalfart config success <on|off|status>",
    "       terminalfart debug <codex|claude|cursor|hermes> <on|off|status>",
    "       terminalfart <command...> [--sound <name>] [--random] [--mute]",
    "       terminalfart --agent-hook <codex|claude|cursor|hermes>",
    "       terminalfart --list-sounds",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    command: [],
    action: null,
    shell: null,
    debugMode: null,
    configKey: null,
    configMode: null,
    hook: false,
    agentHook: null,
    exitCode: 0,
    runtimeMs: 0,
    sound: null,
    random: false,
    mute: false,
    listSounds: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--list-sounds") {
      options.listSounds = true;
    } else if (arg === "install" || arg === "uninstall" || arg === "status" || arg === "debug" || arg === "config") {
      options.action = arg;
      if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
        options.shell = argv[index + 1];
        index += 1;
      }
      if (arg === "debug" && argv[index + 1] && !argv[index + 1].startsWith("--")) {
        options.debugMode = argv[index + 1];
        index += 1;
      } else if (arg === "config") {
        options.configKey = options.shell;
        if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
          options.configMode = argv[index + 1];
          index += 1;
        }
      }
    } else if (arg === "--hook") {
      options.hook = true;
      options.exitCode = Number.parseInt(argv[index + 1] || "0", 10) || 0;
      index += 1;
    } else if (arg === "--duration-ms" || arg === "--runtime-ms") {
      options.runtimeMs = parseDurationMs(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith("--duration-ms=")) {
      options.runtimeMs = parseDurationMs(arg.slice("--duration-ms=".length));
    } else if (arg.startsWith("--runtime-ms=")) {
      options.runtimeMs = parseDurationMs(arg.slice("--runtime-ms=".length));
    } else if (arg === "--agent-hook") {
      options.agentHook = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--random") {
      options.random = true;
    } else if (arg === "--mute") {
      options.mute = true;
    } else if (arg === "--sound") {
      options.sound = argv[index + 1] || "dry";
      index += 1;
    } else if (arg.startsWith("--sound=")) {
      options.sound = arg.slice("--sound=".length) || "dry";
    } else {
      options.command.push(arg);
    }
  }

  if (options.sound && !FAILURE_SOUND_NAMES.includes(options.sound)) {
    options.sound = "dry";
  }

  if (options.random) {
    options.sound = FAILURE_SOUND_NAMES[Math.floor(Math.random() * FAILURE_SOUND_NAMES.length)];
  }

  return options;
}

function parseDurationMs(value) {
  const parsed = Number.parseInt(value || "0", 10);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function listSounds() {
  for (const name of SOUND_NAMES) {
    console.log(`${name.padEnd(10)} = ${SOUND_DEFS[name]}`);
  }
}

function soundPath(name) {
  return path.join(__dirname, "..", "sounds", `${name}.mp3`);
}

function homeDir() {
  return process.env.TERMINALFART_HOME || process.env.HOME || process.env.USERPROFILE || "";
}

function windowsDocumentsDir() {
  if (process.env.TERMINALFART_WINDOWS_DOCUMENTS) {
    return process.env.TERMINALFART_WINDOWS_DOCUMENTS;
  }

  if (process.platform !== "win32") {
    return "";
  }

  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    "[Environment]::GetFolderPath('MyDocuments')",
  ], { encoding: "utf8" });

  const documents = String(result.stdout || "").trim();
  return result.status === 0 && documents ? documents : "";
}

function powershellProfileFromModulePath(modulePath = process.env.PSModulePath) {
  if (!modulePath) {
    return "";
  }

  for (const entry of String(modulePath).split(path.delimiter)) {
    const normalized = entry.trim().replace(/\//g, "\\").replace(/\\+$/, "");
    const lower = normalized.toLowerCase();

    if (lower.endsWith("\\windowspowershell\\modules") || lower.endsWith("\\powershell\\modules")) {
      return path.win32.join(path.win32.dirname(normalized), "Microsoft.PowerShell_profile.ps1");
    }
  }

  return "";
}

function cooldownMs() {
  const value = Number.parseInt(process.env.TERMINALFART_COOLDOWN_MS || "", 10);

  if (Number.isFinite(value) && value >= 0) {
    return value;
  }

  return DEFAULT_COOLDOWN_MS;
}

function stateDir() {
  if (process.env.TERMINALFART_STATE_DIR) {
    return process.env.TERMINALFART_STATE_DIR;
  }

  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "TerminalFart");
  }

  if (process.env.XDG_CACHE_HOME) {
    return path.join(process.env.XDG_CACHE_HOME, "terminalfart");
  }

  return path.join(homeDir(), ".cache", "terminalfart");
}

function cooldownStatePath() {
  return path.join(stateDir(), "cooldown.json");
}

function debugStatePath() {
  return path.join(stateDir(), "debug.json");
}

function configStatePath() {
  return path.join(stateDir(), "config.json");
}

function debugLogPath(agent) {
  return path.join(stateDir(), `${agent}-hook.log`);
}

function readConfigState(file = configStatePath()) {
  if (!fs.existsSync(file)) {
    return { success: false };
  }

  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    return { success: state.success === true };
  } catch {
    return { success: false };
  }
}

function writeConfigState(state, file = configStatePath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ success: state.success === true }, null, 2)}\n`);
}

function setConfig(key, enabled) {
  if (key !== "success") {
    throw new Error(`Unsupported config key: ${key || "(missing)"}`);
  }

  const state = readConfigState();
  state.success = enabled;
  writeConfigState(state);

  return {
    key,
    enabled,
    file: configStatePath(),
  };
}

function readDebugState(file = debugStatePath()) {
  if (!fs.existsSync(file)) {
    return { agents: {} };
  }

  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    return { agents: state.agents || {} };
  } catch {
    return { agents: {} };
  }
}

function writeDebugState(state, file = debugStatePath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ agents: state.agents || {} }, null, 2)}\n`);
}

function debugEnabled(agent) {
  return readDebugState().agents[agent] === true;
}

function setDebug(agent, enabled) {
  if (!SUPPORTED_AGENTS.includes(agent)) {
    throw new Error(`Unsupported debug target: ${agent || "(missing)"}`);
  }

  const state = readDebugState();
  state.agents[agent] = enabled;
  writeDebugState(state);

  return {
    enabled,
    log: debugLogPath(agent),
  };
}

function appendDebugLog(agent, entry) {
  if (!debugEnabled(agent)) {
    return;
  }

  const file = debugLogPath(agent);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

function readCooldownState(file = cooldownStatePath()) {
  if (!fs.existsSync(file)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeCooldownState(state, file = cooldownStatePath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state)}\n`);
}

function shouldFartNow(now = Date.now(), file = cooldownStatePath(), windowMs = cooldownMs()) {
  if (windowMs === 0) {
    return true;
  }

  const state = readCooldownState(file);
  const lastFartAt = Number.isFinite(state.lastFartAt) ? state.lastFartAt : 0;

  return now - lastFartAt >= windowMs;
}

function recordFart(now = Date.now(), file = cooldownStatePath()) {
  writeCooldownState({ lastFartAt: now }, file);
}

function normalizeShell(shell) {
  const value = (shell || "").toLowerCase();

  if (value === "pwsh" || value === "powershell.exe" || value === "pwsh.exe") {
    return "powershell";
  }

  return value;
}

function detectShell() {
  const forced = normalizeShell(process.env.TERMINALFART_SHELL);

  if (SUPPORTED_SHELLS.includes(forced)) {
    return forced;
  }

  const shellName = normalizeShell(path.basename(process.env.SHELL || ""));

  if (SUPPORTED_SHELLS.includes(shellName)) {
    return shellName;
  }

  if (process.platform === "win32") {
    return "powershell";
  }

  return "";
}

function resolveShell(shell) {
  const normalized = normalizeShell(shell);

  if (normalized) {
    return normalized;
  }

  return detectShell();
}

function shellProfilePath(shell) {
  const home = homeDir();
  const normalized = normalizeShell(shell);

  if (!home) {
    return "";
  }

  if (normalized === "bash") {
    return path.join(home, ".bashrc");
  }

  if (normalized === "zsh") {
    return path.join(home, ".zshrc");
  }

  if (normalized === "powershell") {
    if (process.env.TERMINALFART_POWERSHELL_PROFILE) {
      return process.env.TERMINALFART_POWERSHELL_PROFILE;
    }

    if (process.platform === "win32") {
      const profileFromModulePath = powershellProfileFromModulePath();
      if (profileFromModulePath) {
        return profileFromModulePath;
      }

      const documents = windowsDocumentsDir() || path.join(home, "Documents");
      const profileDir = process.env.PSModulePath && process.env.PSModulePath.includes("WindowsPowerShell")
        ? "WindowsPowerShell"
        : "PowerShell";

      return path.join(documents, profileDir, "Microsoft.PowerShell_profile.ps1");
    }

    return path.join(home, ".config", "powershell", "Microsoft.PowerShell_profile.ps1");
  }

  return "";
}

function bashBlock() {
  return [
    BLOCK_START,
    "if command -v terminalfart >/dev/null 2>&1; then",
    "  __terminalfart_last_command=\"\"",
    "  __terminalfart_last_started=0",
    "  __terminalfart_now() {",
    "    date +%s 2>/dev/null || printf 0",
    "  }",
    "  __terminalfart_preexec() {",
    "    case \"$BASH_COMMAND\" in",
    "      __terminalfart_*|terminalfart\\ --hook*) return ;;",
    "    esac",
    "    __terminalfart_last_command=\"$BASH_COMMAND\"",
    "    __terminalfart_last_started=\"$(__terminalfart_now)\"",
    "  }",
    "  __terminalfart_precmd() {",
    "    local __terminalfart_status=$?",
    "    local __terminalfart_duration=0",
    "    local __terminalfart_now_value=\"$(__terminalfart_now)\"",
    "    if [ -n \"$__terminalfart_last_command\" ] && [ \"$__terminalfart_last_started\" -gt 0 ] 2>/dev/null; then",
    "      __terminalfart_duration=$(( (__terminalfart_now_value - __terminalfart_last_started) * 1000 ))",
    "    fi",
    "    if [ -n \"$__terminalfart_last_command\" ]; then",
    "      terminalfart --hook \"$__terminalfart_status\" --duration-ms \"$__terminalfart_duration\" \"$__terminalfart_last_command\"",
    "    fi",
    "    __terminalfart_last_command=\"\"",
    "    __terminalfart_last_started=0",
    "    return \"$__terminalfart_status\"",
    "  }",
    "  trap '__terminalfart_preexec' DEBUG",
    "  case \";$PROMPT_COMMAND;\" in",
    "    *';__terminalfart_precmd;'*) ;;",
    "    *) PROMPT_COMMAND=\"__terminalfart_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}\" ;;",
    "  esac",
    "fi",
    BLOCK_END,
    "",
  ].join("\n");
}

function zshBlock() {
  return [
    BLOCK_START,
    "if command -v terminalfart >/dev/null 2>&1; then",
    "  __terminalfart_last_command=\"\"",
    "  __terminalfart_last_started=0",
    "  __terminalfart_now() {",
    "    date +%s 2>/dev/null || printf 0",
    "  }",
    "  __terminalfart_preexec() {",
    "    __terminalfart_last_command=\"$1\"",
    "    __terminalfart_last_started=\"$(__terminalfart_now)\"",
    "  }",
    "  __terminalfart_precmd() {",
    "    local __terminalfart_status=$?",
    "    local __terminalfart_duration=0",
    "    local __terminalfart_now_value=\"$(__terminalfart_now)\"",
    "    if [ -n \"$__terminalfart_last_command\" ] && [ \"$__terminalfart_last_started\" -gt 0 ] 2>/dev/null; then",
    "      __terminalfart_duration=$(( (__terminalfart_now_value - __terminalfart_last_started) * 1000 ))",
    "    fi",
    "    if [ -n \"$__terminalfart_last_command\" ]; then",
    "      terminalfart --hook \"$__terminalfart_status\" --duration-ms \"$__terminalfart_duration\" \"$__terminalfart_last_command\"",
    "    fi",
    "    __terminalfart_last_command=\"\"",
    "    __terminalfart_last_started=0",
    "    return \"$__terminalfart_status\"",
    "  }",
    "  autoload -Uz add-zsh-hook",
    "  add-zsh-hook -d preexec __terminalfart_preexec 2>/dev/null || true",
    "  add-zsh-hook -d precmd __terminalfart_precmd 2>/dev/null || true",
    "  add-zsh-hook preexec __terminalfart_preexec",
    "  add-zsh-hook precmd __terminalfart_precmd",
    "fi",
    BLOCK_END,
    "",
  ].join("\n");
}

function powershellBlock() {
  return [
    POWERSHELL_BLOCK_START,
    "if (Get-Command terminalfart -ErrorAction SilentlyContinue) {",
    "  $global:TerminalFartLastCommand = $null",
    "  if (Get-Command Set-PSReadLineOption -ErrorAction SilentlyContinue) {",
    "    Set-PSReadLineOption -AddToHistoryHandler {",
    "      param($command)",
    "      $global:TerminalFartLastCommand = $command",
    "      $global:TerminalFartLastStartedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()",
    "      return $true",
    "    }",
    "  }",
    "  if (-not (Test-Path Function:\\TerminalFartOriginalPrompt)) {",
    "    Copy-Item Function:\\prompt Function:\\TerminalFartOriginalPrompt",
    "  }",
    "  $global:TerminalFartLastErrorCount = $global:Error.Count",
    "  function global:prompt {",
    "    $terminalFartSucceeded = $?",
    "    $terminalFartExitCode = if ($terminalFartSucceeded) { 0 } elseif ($global:LASTEXITCODE -is [int] -and $global:LASTEXITCODE -ne 0) { $global:LASTEXITCODE } else { 1 }",
    "    $terminalFartDuration = 0",
    "    if ($global:TerminalFartLastStartedAt -is [long] -or $global:TerminalFartLastStartedAt -is [int]) {",
    "      $terminalFartDuration = [Math]::Max(0, [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [int64]$global:TerminalFartLastStartedAt)",
    "    }",
    "    $terminalFartContext = \"$global:TerminalFartLastCommand\"",
    "    if ($terminalFartExitCode -ne 0) {",
    "      if ($global:Error.Count -gt $global:TerminalFartLastErrorCount -and $global:Error[0]) {",
    "        $terminalFartContext = \"$terminalFartContext $($global:Error[0].Exception.Message)\"",
    "      }",
    "    }",
    "    if ($global:TerminalFartLastCommand) {",
    "      terminalfart --hook $terminalFartExitCode --duration-ms $terminalFartDuration \"$terminalFartContext\"",
    "    }",
    "    $global:TerminalFartLastCommand = $null",
    "    $global:TerminalFartLastStartedAt = $null",
    "    $global:TerminalFartLastErrorCount = $global:Error.Count",
    "    & TerminalFartOriginalPrompt",
    "  }",
    "}",
    POWERSHELL_BLOCK_END,
    "",
  ].join("\n");
}

function shellBlock(shell) {
  const normalized = normalizeShell(shell);

  if (normalized === "bash") {
    return bashBlock();
  }

  if (normalized === "zsh") {
    return zshBlock();
  }

  if (normalized === "powershell") {
    return powershellBlock();
  }

  return "";
}

function replaceManagedBlock(content, block) {
  const pattern = new RegExp(
    `${escapeRegExp(BLOCK_START)}[\\s\\S]*?${escapeRegExp(BLOCK_END)}\\r?\\n?`,
    "g",
  );
  const withoutBlock = content.replace(pattern, "");

  return `${withoutBlock.replace(/\s*$/, "")}\n\n${block}`;
}

function removeManagedBlock(content) {
  const pattern = new RegExp(
    `${escapeRegExp(BLOCK_START)}[\\s\\S]*?${escapeRegExp(BLOCK_END)}\\r?\\n?`,
    "g",
  );

  return content.replace(pattern, "").replace(/\s*$/, "\n");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function installShell(shell) {
  const resolved = resolveShell(shell);
  const profile = shellProfilePath(resolved);
  const block = shellBlock(resolved);

  if (!profile || !block) {
    throw new Error(`Could not detect a supported shell. Try: terminalfart install bash`);
  }

  fs.mkdirSync(path.dirname(profile), { recursive: true });

  const current = fs.existsSync(profile) ? fs.readFileSync(profile, "utf8") : "";
  fs.writeFileSync(profile, replaceManagedBlock(current, block));

  return { profile, shell: resolved };
}

function uninstallShell(shell) {
  const resolved = resolveShell(shell);
  const profile = shellProfilePath(resolved);

  if (!profile || !shellBlock(resolved)) {
    throw new Error(`Could not detect a supported shell. Try: terminalfart uninstall bash`);
  }

  if (!fs.existsSync(profile)) {
    return { profile, shell: resolved };
  }

  const current = fs.readFileSync(profile, "utf8");
  fs.writeFileSync(profile, removeManagedBlock(current));

  return { profile, shell: resolved };
}

function shellStatus(shell) {
  const resolved = normalizeShell(shell);
  const profile = shellProfilePath(resolved);
  const content = profile && fs.existsSync(profile) ? fs.readFileSync(profile, "utf8") : "";

  return {
    installed: content.includes(BLOCK_START) && content.includes(BLOCK_END),
    profile,
    shell: resolved,
  };
}

function statusTargets(shell) {
  const resolved = normalizeTarget(shell);

  if (resolved) {
    return [resolved];
  }

  return [...SUPPORTED_SHELLS, ...SUPPORTED_AGENTS];
}

function printStatus(shell) {
  for (const target of statusTargets(shell)) {
    const status = SUPPORTED_AGENTS.includes(target) ? agentStatus(target) : shellStatus(target);
    const mark = status.installed ? "installed" : "not installed";
    console.log(`${status.shell.padEnd(10)} ${mark} ${status.profile}`);
  }
}

function restartHint(shell) {
  if (shell === "bash") {
    return "Restart your terminal, or run: source ~/.bashrc";
  }

  if (shell === "zsh") {
    return "Restart your terminal, or run: source ~/.zshrc";
  }

  if (shell === "powershell") {
    return "Restart PowerShell, or run: . $PROFILE";
  }

  return "Restart your terminal.";
}

function agentCommand(adapter) {
  return `terminalfart --agent-hook ${adapter}`;
}

function quoteExecutablePath(file, platform = process.platform) {
  if (platform === "win32") {
    return `"${file.replace(/"/g, '\\"')}"`;
  }

  return `'${file.replace(/'/g, "'\\''")}'`;
}

function agentCommandWithExecutable(adapter, executable, platform = process.platform) {
  return `${quoteExecutablePath(executable, platform)} --agent-hook ${adapter}`;
}

function escapedTomlString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapedYamlDoubleQuotedString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function resolveTerminalFartExecutable(platform = process.platform, runner = spawnSync) {
  if (platform === "win32") {
    const result = runner("where.exe", ["terminalfart"], { encoding: "utf8" });
    const lines = String(result.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const cmd = lines.find((line) => line.toLowerCase().endsWith(".cmd"));
    const executable = cmd || lines[0];

    if (result.status === 0 && executable) {
      return executable;
    }
  } else {
    const result = runner("sh", ["-lc", "command -v terminalfart"], { encoding: "utf8" });
    const executable = String(result.stdout || "").trim().split(/\r?\n/)[0];

    if (result.status === 0 && executable) {
      return executable;
    }
  }

  throw new Error("Could not find terminalfart on PATH. Install it globally or run npm link first.");
}

function codexHome() {
  return process.env.TERMINALFART_CODEX_HOME || process.env.CODEX_HOME || path.join(homeDir(), ".codex");
}

function claudeHome() {
  return process.env.TERMINALFART_CLAUDE_HOME || path.join(homeDir(), ".claude");
}

function cursorHome() {
  return process.env.TERMINALFART_CURSOR_HOME || path.join(homeDir(), ".cursor");
}

function hermesHome() {
  return process.env.TERMINALFART_HERMES_HOME || path.join(homeDir(), ".hermes");
}

function agentConfigPath(agent) {
  if (agent === "codex") {
    return path.join(codexHome(), "config.toml");
  }

  if (agent === "claude") {
    return path.join(claudeHome(), "settings.json");
  }

  if (agent === "cursor") {
    return path.join(cursorHome(), "hooks.json");
  }

  if (agent === "hermes") {
    return path.join(hermesHome(), "config.yaml");
  }

  return "";
}

function normalizeTarget(target) {
  const value = normalizeShell(target);

  if (SUPPORTED_AGENTS.includes(value)) {
    return value;
  }

  return value;
}

function readTextFile(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function writeTextFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function readJsonFile(file) {
  const content = readTextFile(file).trim();

  if (!content) {
    return {};
  }

  return JSON.parse(content);
}

function writeJsonFile(file, value) {
  writeTextFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function hasTerminalFartCommand(entry) {
  if (!entry || typeof entry !== "object") {
    return false;
  }

  if (typeof entry.command === "string" && /terminalfart(?:\.cmd)?["']?\s+--agent-hook/.test(entry.command)) {
    return true;
  }

  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some(hasTerminalFartCommand);
  }

  return false;
}

function removeJsonHookEntries(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.filter((entry) => !hasTerminalFartCommand(entry));
}

function addJsonHookEntry(settings, eventName, entry) {
  settings.hooks ||= {};
  settings.hooks[eventName] = removeJsonHookEntries(settings.hooks[eventName]);
  settings.hooks[eventName].push(entry);
}

function removeJsonHookEntry(settings, eventName) {
  if (!settings.hooks || !settings.hooks[eventName]) {
    return;
  }

  settings.hooks[eventName] = removeJsonHookEntries(settings.hooks[eventName]);

  if (settings.hooks[eventName].length === 0) {
    delete settings.hooks[eventName];
  }
}

function commandHook(adapter, command = agentCommand(adapter)) {
  return {
    type: "command",
    command,
    timeout: AGENT_HOOK_TIMEOUT_SECONDS,
  };
}

function installClaude(executable = resolveTerminalFartExecutable()) {
  const config = agentConfigPath("claude");
  const settings = readJsonFile(config);
  const command = agentCommandWithExecutable("claude", executable);

  removeJsonHookEntry(settings, "PostToolUseFailure");
  addJsonHookEntry(settings, "PostToolUse", {
    matcher: "Bash",
    hooks: [commandHook("claude", command)],
  });

  writeJsonFile(config, settings);

  return { profile: config, shell: "claude" };
}

function uninstallClaude() {
  const config = agentConfigPath("claude");
  const settings = readJsonFile(config);

  removeJsonHookEntry(settings, "PostToolUseFailure");
  removeJsonHookEntry(settings, "PostToolUse");
  writeJsonFile(config, settings);

  return { profile: config, shell: "claude" };
}

function cursorHookEntry(adapter, command = agentCommand(adapter)) {
  return {
    command,
    timeout: AGENT_HOOK_TIMEOUT_SECONDS,
  };
}

function installCursor(executable = resolveTerminalFartExecutable()) {
  const config = agentConfigPath("cursor");
  const settings = readJsonFile(config);
  const command = agentCommandWithExecutable("cursor", executable);

  settings.version ||= 1;
  addJsonHookEntry(settings, "afterShellExecution", cursorHookEntry("cursor", command));
  addJsonHookEntry(settings, "postToolUseFailure", cursorHookEntry("cursor", command));

  writeJsonFile(config, settings);

  return { profile: config, shell: "cursor" };
}

function uninstallCursor() {
  const config = agentConfigPath("cursor");
  const settings = readJsonFile(config);

  removeJsonHookEntry(settings, "afterShellExecution");
  removeJsonHookEntry(settings, "postToolUseFailure");
  writeJsonFile(config, settings);

  return { profile: config, shell: "cursor" };
}

function managedTomlBlock(agent, command = agentCommand(agent)) {
  const escapedCommand = escapedTomlString(command);

  return [
    `# >>> terminalfart ${agent} >>>`,
    "[[hooks.PostToolUse]]",
    'matcher = ".*"',
    "",
    "  [[hooks.PostToolUse.hooks]]",
    '  type = "command"',
    `  command = "${escapedCommand}"`,
    `  commandWindows = "${escapedCommand}"`,
    `  timeout = ${AGENT_HOOK_TIMEOUT_SECONDS}`,
    `# <<< terminalfart ${agent} <<<`,
    "",
  ].join("\n");
}

function removeManagedTomlBlock(content, agent) {
  const start = `# >>> terminalfart ${agent} >>>`;
  const end = `# <<< terminalfart ${agent} <<<`;
  const pattern = new RegExp(
    `${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\r?\\n?`,
    "g",
  );

  return content.replace(pattern, "").replace(/\s*$/, "\n");
}

function enableTomlFeature(content, section, key) {
  const sectionPattern = new RegExp(`(^|\\n)\\[${escapeRegExp(section)}\\]\\r?\\n`, "m");
  const match = content.match(sectionPattern);

  if (!match || match.index === undefined) {
    return `${content.replace(/\s*$/, "")}\n\n[${section}]\n${key} = true\n`;
  }

  const sectionStart = match.index + match[1].length;
  const afterHeader = sectionStart + match[0].length - match[1].length;
  const nextSection = content.slice(afterHeader).search(/\n\[/);
  const sectionEnd = nextSection === -1 ? content.length : afterHeader + nextSection;
  const before = content.slice(0, afterHeader);
  const body = content.slice(afterHeader, sectionEnd);
  const after = content.slice(sectionEnd);
  const keyPattern = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*.*$`, "m");
  const nextBody = keyPattern.test(body) ? body.replace(keyPattern, `${key} = true`) : `${body.replace(/\s*$/, "")}\n${key} = true\n`;

  return `${before}${nextBody}${after}`;
}

function installCodex(executable = resolveTerminalFartExecutable()) {
  const config = agentConfigPath("codex");
  const content = readTextFile(config);
  const withoutBlock = removeManagedTomlBlock(content, "codex");
  const withFeature = enableTomlFeature(withoutBlock, "features", "hooks");
  const command = agentCommandWithExecutable("codex", executable);

  writeTextFile(config, `${withFeature.replace(/\s*$/, "")}\n\n${managedTomlBlock("codex", command)}`);

  return { profile: config, shell: "codex" };
}

function uninstallCodex() {
  const config = agentConfigPath("codex");

  writeTextFile(config, removeManagedTomlBlock(readTextFile(config), "codex"));

  return { profile: config, shell: "codex" };
}

function hermesEntryLines(command = agentCommand("hermes")) {
  const escapedCommand = escapedYamlDoubleQuotedString(command);

  return [
    "    # >>> terminalfart hermes >>>",
    '    - matcher: "terminal|shell|bash"',
    `      command: "${escapedCommand}"`,
    `      timeout: ${AGENT_HOOK_TIMEOUT_SECONDS}`,
    "    # <<< terminalfart hermes <<<",
  ];
}

function removeHermesBlock(content) {
  const pattern = /(?:^|\n)    # >>> terminalfart hermes >>>[\s\S]*?    # <<< terminalfart hermes <<<\r?\n?/g;

  return content.replace(pattern, "\n").replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "\n");
}

function installHermes(executable = resolveTerminalFartExecutable()) {
  const config = agentConfigPath("hermes");
  const withoutBlock = removeHermesBlock(readTextFile(config));
  const lines = withoutBlock ? withoutBlock.replace(/\s*$/, "").split(/\r?\n/) : [];
  const hooksIndex = lines.findIndex((line) => line === "hooks:");
  const command = agentCommandWithExecutable("hermes", executable);
  const entry = hermesEntryLines(command);

  if (hooksIndex === -1) {
    lines.push("", "hooks:", "  post_tool_call:", ...entry);
  } else {
    const hookBlockEnd = findYamlBlockEnd(lines, hooksIndex, 0);
    const eventIndex = findYamlChild(lines, hooksIndex + 1, hookBlockEnd, "post_tool_call", 2);

    if (eventIndex === -1) {
      lines.splice(hookBlockEnd, 0, "  post_tool_call:", ...entry);
    } else {
      lines.splice(eventIndex + 1, 0, ...entry);
    }
  }

  writeTextFile(config, `${lines.join("\n").replace(/\s*$/, "")}\n`);

  return { profile: config, shell: "hermes" };
}

function uninstallHermes() {
  const config = agentConfigPath("hermes");

  writeTextFile(config, removeHermesBlock(readTextFile(config)));

  return { profile: config, shell: "hermes" };
}

function findYamlBlockEnd(lines, startIndex, indent) {
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.trim() && leadingSpaces(line) <= indent) {
      return index;
    }
  }

  return lines.length;
}

function findYamlChild(lines, startIndex, endIndex, key, indent) {
  const target = `${" ".repeat(indent)}${key}:`;

  for (let index = startIndex; index < endIndex; index += 1) {
    if (lines[index] === target) {
      return index;
    }
  }

  return -1;
}

function leadingSpaces(value) {
  return value.length - value.trimStart().length;
}

function installTarget(target) {
  const resolved = normalizeTarget(target);

  if (SUPPORTED_AGENTS.includes(resolved)) {
    return installAgent(resolved);
  }

  return installShell(resolved);
}

function uninstallTarget(target) {
  const resolved = normalizeTarget(target);

  if (SUPPORTED_AGENTS.includes(resolved)) {
    return uninstallAgent(resolved);
  }

  return uninstallShell(resolved);
}

function installAgent(agent) {
  if (agent === "codex") {
    return installCodex();
  }

  if (agent === "claude") {
    return installClaude();
  }

  if (agent === "cursor") {
    return installCursor();
  }

  if (agent === "hermes") {
    return installHermes();
  }

  throw new Error(`Unsupported agent: ${agent}`);
}

function uninstallAgent(agent) {
  if (agent === "codex") {
    return uninstallCodex();
  }

  if (agent === "claude") {
    return uninstallClaude();
  }

  if (agent === "cursor") {
    return uninstallCursor();
  }

  if (agent === "hermes") {
    return uninstallHermes();
  }

  throw new Error(`Unsupported agent: ${agent}`);
}

function agentStatus(agent) {
  const config = agentConfigPath(agent);
  const content = readTextFile(config);

  if (agent === "codex") {
    return { installed: content.includes("# >>> terminalfart codex >>>"), profile: config, shell: agent };
  }

  if (agent === "hermes") {
    return { installed: content.includes("# >>> terminalfart hermes >>>"), profile: config, shell: agent };
  }

  if (agent === "claude" || agent === "cursor") {
    const settings = content.trim() ? JSON.parse(content) : {};
    const installed = Object.values(settings.hooks || {}).some((entries) => {
      return Array.isArray(entries) && entries.some(hasTerminalFartCommand);
    });
    return { installed, profile: config, shell: agent };
  }

  return { installed: false, profile: "", shell: agent };
}

function pathEntries() {
  return (process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
}

function windowsExtensions() {
  return (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean);
}

function resolveCommand(command) {
  if (process.platform !== "win32") {
    return command;
  }

  if (/[\\/]/.test(command) || path.extname(command)) {
    return command;
  }

  for (const entry of pathEntries()) {
    for (const extension of windowsExtensions()) {
      const candidate = path.join(entry, `${command}${extension.toLowerCase()}`);

      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return command;
}

function commandNeedsShell(command, platform = process.platform) {
  return platform === "win32" && /\.(bat|cmd)$/i.test(command);
}

function quoteWindowsCmdArg(value) {
  const text = String(value);

  if (!/[()\s"%!^&|<>]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function windowsCmdArgs(command, args) {
  return [
    "/d",
    "/c",
    ["call", command, ...args].map(quoteWindowsCmdArg).join(" "),
  ];
}

function playbackCandidates(file) {
  if (process.platform === "darwin") {
    return [["afplay", [file]]];
  }

  if (process.platform === "win32") {
    const script = windowsPlaybackScript();

    return [["powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script, file]]];
  }

  return [
    ["paplay", [file]],
    ["aplay", [file]],
    ["ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", file]],
    ["mpg123", ["-q", file]],
    ["mpv", ["--really-quiet", file]],
  ];
}

function windowsPlaybackScript() {
  return [
    "& { param($soundPath)",
    "$ErrorActionPreference = 'Stop'",
    "$typeName = 'TerminalFartMciAudio'",
    "if (-not ($typeName -as [type])) {",
    "  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class TerminalFartMciAudio { [DllImport(\"winmm.dll\", CharSet = CharSet.Unicode)] public static extern int mciSendString(string command, System.Text.StringBuilder buffer, int bufferSize, IntPtr hwndCallback); }'",
    "}",
    "function Invoke-TerminalFartMci($command) {",
    "  $buffer = New-Object System.Text.StringBuilder 512",
    "  $code = [TerminalFartMciAudio]::mciSendString($command, $buffer, $buffer.Capacity, [IntPtr]::Zero)",
    "  if ($code -ne 0) { throw \"MCI playback failed with code $code for: $command\" }",
    "  return $buffer.ToString()",
    "}",
    "$path = (Resolve-Path $soundPath).Path",
    "$alias = 'terminalfart_' + [Guid]::NewGuid().ToString('N')",
    "Invoke-TerminalFartMci \"open `\"$path`\" type mpegvideo alias $alias\" | Out-Null",
    "try {",
    "  Invoke-TerminalFartMci \"set $alias time format milliseconds\" | Out-Null",
    "  Invoke-TerminalFartMci \"play $alias wait\" | Out-Null",
    "} finally {",
    "  try { Invoke-TerminalFartMci \"close $alias\" | Out-Null } catch {}",
    "}",
    "}",
  ].join("; ");
}

function runPlayback(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });

    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

async function playSound(name) {
  const file = soundPath(name);

  if (!fs.existsSync(file)) {
    return false;
  }

  for (const [command, args] of playbackCandidates(file)) {
    if (await runPlayback(command, args)) {
      return true;
    }
  }

  return false;
}

function selectFailureEvent(exitCode, commandText) {
  const text = String(commandText || "").toLowerCase();

  if (/\bgit\s+push\b/.test(text)) {
    return { type: "failure", state: "git_push_failure", sound: "hellacious" };
  }

  if (/\b(build|tsc|webpack|vite|rollup|esbuild)\b/.test(text)) {
    return { type: "failure", state: "build_failure", sound: "wet" };
  }

  if (/\b(warn|warning|lint)\b/.test(text)) {
    return { type: "failure", state: "warning_lint_failure", sound: "toot" };
  }

  if (/\b(command not found|not recognized|enoent|not executable|permission denied)\b/.test(text)) {
    return { type: "failure", state: "command_missing_permission_denied", sound: "poop-toot" };
  }

  if (/\b(test|pytest|jest|vitest|mocha)\b/.test(text)) {
    return { type: "failure", state: "test_failure", sound: "dry" };
  }

  if (exitCode >= 128) {
    return { type: "failure", state: "fatal_signal_exit_128_plus", sound: "hellacious" };
  }

  if (exitCode === 126 || exitCode === 127) {
    return { type: "failure", state: "command_missing_permission_denied", sound: "poop-toot" };
  }

  if (exitCode > 1) {
    return { type: "failure", state: "generic_exit_gt_1", sound: "wet" };
  }

  return { type: "failure", state: "generic_exit_1", sound: "dry" };
}

function selectFailureSound(exitCode, commandText, options = {}) {
  if (options.random) {
    return FAILURE_SOUND_NAMES[Math.floor(Math.random() * FAILURE_SOUND_NAMES.length)];
  }

  if (options.sound && FAILURE_SOUND_NAMES.includes(options.sound)) {
    return options.sound;
  }

  return selectFailureEvent(exitCode, commandText).sound;
}

function textNeedsAttention(text) {
  return [
    /\bapproval (?:required|needed)\b/i,
    /\brequires? approval\b/i,
    /\binput required\b/i,
    /\brequires? (?:user )?input\b/i,
    /\bwaiting for (?:user )?(?:input|response|confirmation|approval)\b/i,
    /\bblocked (?:on|by|until|waiting for).{0,40}\b(?:approval|input|confirmation|user)\b/i,
    /\bconfirmation (?:required|needed)\b/i,
    /\bplease confirm\b/i,
    /\bconfirm(?:\?| to continue| this action|\s+\[?[yYnN]\/[yYnN]\]?)/i,
    /\bcontinue\?/i,
    /\bpress (?:enter|return)\b/i,
  ].some((pattern) => pattern.test(text));
}

function selectCommandEvent(exitCode, commandText, details = {}, options = {}) {
  const runtimeMs = parseDurationMs(details.runtimeMs);

  if (exitCode !== 0) {
    const event = selectFailureEvent(exitCode, commandText);
    event.sound = selectFailureSound(exitCode, commandText, options);
    event.longTaskDone = runtimeMs >= LONG_TASK_DONE_MS;
    return event;
  }

  if (details.agent && textNeedsAttention(details.outputText || "")) {
    return { type: "agent_needs_you", state: "agent_needs_you", sound: "needs-you" };
  }

  if (runtimeMs >= LONG_TASK_DONE_MS) {
    return { type: "long_task_done", state: "exit_0_runtime_120s_plus", sound: "done-long" };
  }

  return { type: "success", state: "exit_0", sound: "success" };
}

function eventEnabled(event, config = readConfigState()) {
  if (event.type === "success") {
    return config.success === true;
  }

  return true;
}

async function fart(exitCode, commandText, options = {}, details = {}) {
  const event = selectCommandEvent(exitCode, commandText, details, options);

  if (options.mute) {
    return {
      attempted: false,
      reason: "mute",
      event: event.state,
      sound: event.sound,
    };
  }

  if (!eventEnabled(event)) {
    return {
      attempted: false,
      reason: "success-disabled",
      event: event.state,
      sound: event.sound,
    };
  }

  if (event.type === "failure" && !shouldFartNow()) {
    return {
      attempted: false,
      reason: "cooldown",
      event: event.state,
      sound: event.sound,
    };
  }

  if (event.type === "failure") {
    recordFart();
  }

  const played = await playSound(event.sound);

  if (event.type === "failure") {
    console.log("pfffft");
  }

  return {
    attempted: true,
    played,
    event: event.state,
    sound: event.sound,
    type: event.type,
  };
}

function readStdin() {
  if (process.stdin.isTTY) {
    return Promise.resolve("");
  }

  return new Promise((resolve) => {
    let content = "";

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      content += chunk;
    });
    process.stdin.on("end", () => resolve(content));
  });
}

function parseHookPayload(input) {
  if (!input.trim()) {
    return {};
  }

  try {
    return JSON.parse(input);
  } catch {
    return { raw: input };
  }
}

function parseMaybeJson(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  if (!trimmed || !/^[{[]/.test(trimmed)) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function findFirstNumber(value, keys) {
  if (!value || typeof value !== "object") {
    return null;
  }

  for (const key of keys) {
    if (Number.isInteger(value[key])) {
      return value[key];
    }

    if (typeof value[key] === "string" && /^-?\d+$/.test(value[key])) {
      return Number.parseInt(value[key], 10);
    }
  }

  return null;
}

function payloadExitCode(payload) {
  const direct = findFirstNumber(payload, [
    "exit_code",
    "exitCode",
    "exit_status",
    "exitStatus",
    "status",
    "return_code",
    "returnCode",
    "code",
  ]);

  if (direct !== null) {
    return direct;
  }

  for (const key of ["tool_response", "tool_result", "tool_output", "response", "result", "output"]) {
    const nested = parseMaybeJson(payload[key]);
    const nestedCode = findFirstNumber(nested, [
      "exit_code",
      "exitCode",
      "exit_status",
      "exitStatus",
      "status",
      "return_code",
      "returnCode",
      "code",
    ]);

    if (nestedCode !== null) {
      return nestedCode;
    }
  }

  return null;
}

function hasFailureFlag(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (value.success === false || value.ok === false || value.failed === true || value.is_error === true) {
    return true;
  }

  if (typeof value.error === "string" && value.error.trim()) {
    return true;
  }

  return false;
}

function payloadFailed(payload) {
  const code = payloadExitCode(payload);

  if (code !== null) {
    return code !== 0;
  }

  if (hasFailureFlag(payload)) {
    return true;
  }

  for (const key of ["tool_response", "tool_result", "tool_output", "response", "result", "output"]) {
    const nested = parseMaybeJson(payload[key]);

    if (hasFailureFlag(nested)) {
      return true;
    }
  }

  return payload.hook_event_name === "PostToolUseFailure"
    || payload.hookEventName === "PostToolUseFailure"
    || payload.event === "postToolUseFailure"
    || payload.event === "post_tool_call_failure";
}

function payloadRuntimeMs(payload) {
  const keys = [
    "duration_ms",
    "durationMs",
    "runtime_ms",
    "runtimeMs",
    "elapsed_ms",
    "elapsedMs",
  ];
  const direct = findFirstNumber(payload, keys);

  if (direct !== null) {
    return direct;
  }

  for (const key of ["tool_response", "tool_result", "tool_output", "response", "result", "output"]) {
    const nested = parseMaybeJson(payload[key]);
    const nestedRuntime = findFirstNumber(nested, keys);

    if (nestedRuntime !== null) {
      return nestedRuntime;
    }
  }

  return 0;
}

function collectOutputValue(value, parts, seen) {
  if (value === null || value === undefined) {
    return;
  }

  if (typeof value === "string") {
    if (value.trim()) {
      parts.push(value);
    }

    const parsed = parseMaybeJson(value);

    if (parsed !== value) {
      collectOutputFields(parsed, parts, seen);
    }
    return;
  }

  collectOutputFields(value, parts, seen);
}

function collectOutputFields(value, parts, seen) {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return;
  }

  seen.add(value);

  for (const key of [
    "stdout",
    "stderr",
    "std_out",
    "std_err",
    "output",
    "tool_output",
    "toolOutput",
    "tool_response",
    "toolResponse",
    "tool_result",
    "toolResult",
    "response",
    "result",
  ]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      collectOutputValue(value[key], parts, seen);
    }
  }
}

function payloadOutputText(payload) {
  const parts = [];

  collectOutputFields(payload, parts, new Set());

  return parts.join("\n");
}

function payloadNeedsAttention(payload) {
  return textNeedsAttention(payloadOutputText(payload));
}

function payloadCommandText(payload) {
  const values = [
    payload.command,
    payload.cmd,
    payload.tool_input && payload.tool_input.command,
    payload.tool_input && payload.tool_input.cmd,
    payload.toolInput && payload.toolInput.command,
    payload.args && payload.args.command,
    payload.args && payload.args.cmd,
    payload.name,
    payload.tool_name,
    payload.toolName,
  ];

  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  const result = parseMaybeJson(payload.result);

  if (result && typeof result === "object") {
    return payloadCommandText(result);
  }

  return "";
}

async function runAgentHook(adapter, options) {
  if (!SUPPORTED_AGENTS.includes(adapter)) {
    throw new Error(`Unsupported agent hook: ${adapter || "(missing)"}`);
  }

  const rawInput = await readStdin();
  const payload = parseHookPayload(rawInput);
  const payloadCode = payloadExitCode(payload);
  const outputText = payloadOutputText(payload);
  const needsAttention = textNeedsAttention(outputText);
  const failed = payloadFailed(payload);
  const exitCode = failed ? payloadCode || 1 : 0;
  const runtimeMs = payloadRuntimeMs(payload);
  const command = payloadCommandText(payload);

  if (!failed && !needsAttention && payloadCode === null) {
    appendDebugLog(adapter, {
      event: "agent-hook",
      rawInput,
      payload,
      failed,
      needsAttention,
      exitCode: payloadCode,
      command,
      fart: { attempted: false, reason: "no-command-event" },
    });
    return 0;
  }

  const result = await fart(exitCode, command, options, { agent: true, outputText, runtimeMs });
  appendDebugLog(adapter, {
    event: "agent-hook",
    rawInput,
    payload,
    failed,
    needsAttention,
    exitCode,
    runtimeMs,
    command,
    fart: result,
  });
  return 0;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.listSounds) {
    listSounds();
    return 0;
  }

  if (options.agentHook) {
    return runAgentHook(options.agentHook, options);
  }

  if (options.action === "install") {
    const result = installTarget(options.shell);
    console.log(`Installed TerminalFart for ${result.shell}: ${result.profile}`);
    console.log(SUPPORTED_AGENTS.includes(result.shell) ? "Restart the agent for the hook to load." : restartHint(result.shell));
    return 0;
  }

  if (options.action === "uninstall") {
    const result = uninstallTarget(options.shell);
    console.log(`Uninstalled TerminalFart for ${result.shell}: ${result.profile}`);
    console.log(SUPPORTED_AGENTS.includes(result.shell) ? "Restart the agent to finish uninstalling." : "Restart your terminal to finish uninstalling.");
    return 0;
  }

  if (options.action === "status") {
    printStatus(options.shell);
    return 0;
  }

  if (options.action === "config") {
    if (options.configKey !== "success") {
      console.error("Usage: terminalfart config success <on|off|status>");
      return 2;
    }

    if (options.configMode === "on" || options.configMode === "off") {
      const result = setConfig(options.configKey, options.configMode === "on");
      console.log(`Success sounds ${result.enabled ? "enabled" : "disabled"}.`);
      return 0;
    }

    if (!options.configMode || options.configMode === "status") {
      console.log(`Success sounds ${readConfigState().success ? "enabled" : "disabled"}.`);
      return 0;
    }

    console.error("Usage: terminalfart config success <on|off|status>");
    return 2;
  }

  if (options.action === "debug") {
    const target = normalizeTarget(options.shell);

    if (!SUPPORTED_AGENTS.includes(target)) {
      console.error("Usage: terminalfart debug <codex|claude|cursor|hermes> <on|off|status>");
      return 2;
    }

    if (options.debugMode === "on" || options.debugMode === "off") {
      const result = setDebug(target, options.debugMode === "on");
      console.log(`Debug ${result.enabled ? "enabled" : "disabled"} for ${target}: ${result.log}`);
      return 0;
    }

    if (options.debugMode === "status") {
      console.log(`Debug ${debugEnabled(target) ? "enabled" : "disabled"} for ${target}: ${debugLogPath(target)}`);
      return 0;
    }

    console.error("Usage: terminalfart debug <codex|claude|cursor|hermes> <on|off|status>");
    return 2;
  }

  if (options.hook) {
    await fart(options.exitCode, options.command.join(" "), options, { runtimeMs: options.runtimeMs });
    return 0;
  }

  if (options.command.length === 0) {
    console.error(usage());
    return 2;
  }

  const command = resolveCommand(options.command[0]);
  const commandArgs = options.command.slice(1);
  const useWindowsCommandShell = commandNeedsShell(command);
  const spawnCommand = useWindowsCommandShell ? "cmd.exe" : command;
  const spawnArgs = useWindowsCommandShell ? windowsCmdArgs(command, commandArgs) : commandArgs;
  const startedAt = Date.now();
  let child;

  try {
    child = spawn(spawnCommand, spawnArgs, {
      stdio: "inherit",
      windowsVerbatimArguments: useWindowsCommandShell,
    });
  } catch (error) {
    console.error(error.message);
    await fart(127, `${options.command.join(" ")} ${error.message}`, options, { runtimeMs: Date.now() - startedAt });
    return 127;
  }

  return new Promise((resolve) => {
    child.on("error", async (error) => {
      console.error(error.message);
      await fart(127, `${options.command.join(" ")} ${error.message}`, options, { runtimeMs: Date.now() - startedAt });

      resolve(127);
    });

    child.on("exit", async (code, signal) => {
      if (code === 0) {
        await fart(0, options.command.join(" "), options, { runtimeMs: Date.now() - startedAt });
        resolve(0);
        return;
      }

      const exitCode = code === null ? 1 : code;
      await fart(exitCode, options.command.join(" "), options, { runtimeMs: Date.now() - startedAt });

      if (signal) {
        console.error(`command exited after signal ${signal}`);
      }

      resolve(exitCode);
    });
  });
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  BLOCK_END,
  BLOCK_START,
  AGENT_HOOK_TIMEOUT_SECONDS,
  DEFAULT_COOLDOWN_MS,
  LONG_TASK_DONE_MS,
  EVENT_SOUND_DEFS,
  FAILURE_SOUND_DEFS,
  FAILURE_SOUND_NAMES,
  SOUND_DEFS,
  SOUND_NAMES,
  SUPPORTED_AGENTS,
  SUPPORTED_SHELLS,
  agentCommandWithExecutable,
  agentConfigPath,
  agentStatus,
  bashBlock,
  detectShell,
  enableTomlFeature,
  escapedTomlString,
  escapedYamlDoubleQuotedString,
  fart,
  hasFailureFlag,
  installCodex,
  installCursor,
  installHermes,
  installShell,
  installClaude,
  installTarget,
  normalizeShell,
  normalizeTarget,
  parseHookPayload,
  parseArgs,
  playbackCandidates,
  playSound,
  configStatePath,
  eventEnabled,
  payloadCommandText,
  payloadExitCode,
  payloadFailed,
  payloadNeedsAttention,
  payloadOutputText,
  payloadRuntimeMs,
  printStatus,
  cooldownMs,
  cooldownStatePath,
  appendDebugLog,
  debugEnabled,
  debugLogPath,
  debugStatePath,
  powershellBlock,
  powershellProfileFromModulePath,
  readCooldownState,
  readConfigState,
  readDebugState,
  recordFart,
  removeManagedBlock,
  removeManagedTomlBlock,
  replaceManagedBlock,
  restartHint,
  resolveCommand,
  resolveShell,
  resolveTerminalFartExecutable,
  runAgentHook,
  selectCommandEvent,
  selectFailureEvent,
  selectFailureSound,
  setDebug,
  setConfig,
  shellProfilePath,
  shellStatus,
  shouldFartNow,
  soundPath,
  commandNeedsShell,
  quoteWindowsCmdArg,
  uninstallShell,
  uninstallTarget,
  usage,
  windowsPlaybackScript,
  windowsCmdArgs,
  writeCooldownState,
  writeDebugState,
  zshBlock,
};
