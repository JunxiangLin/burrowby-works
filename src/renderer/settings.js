(() => {
  const $ = (id) => document.getElementById(id);
  const SPECIES = ['bunny', 'cat', 'bear', 'frog', 'chick', 'axolotl'];
  $('fSpecies').innerHTML = SPECIES.map((s) => `<option value="${s}">${s}</option>`).join('');

  function flash(el, text, ok) {
    el.textContent = text;
    el.className = `msg ${ok ? 'ok' : 'bad'}`;
  }

  function showCli(cli) {
    const status = $('cli-status');
    const detail = $('cli-detail');
    if (!cli.found) {
      status.textContent = 'not found ✖';
      detail.textContent =
        'Install Claude Code (https://claude.com/claude-code), open a terminal, run "claude" once and sign in. Then click Check again.';
    } else if (!cli.loggedIn) {
      status.textContent = 'found, not signed in ✖';
      detail.textContent = `${cli.path}. Open a terminal, run "claude" and sign in. ${cli.error || ''}`;
    } else {
      status.textContent = `ready ✔ (${cli.email || 'signed in'}, ${cli.authMethod})`;
      detail.textContent = `${cli.path} · ${cli.version}`;
    }
  }

  async function load() {
    const st = await window.settings.status();
    showCli(st.cli);
    if (st.version) $('app-version').textContent = 'v' + st.version;
    $('cli-path').value = st.config.claudePath || '';
    for (const k of ['model', 'quickModel', 'deepModel']) $(k).value = st.config[k];
    $('roam').checked = st.config.roam;
    $('notifyJobs').checked = st.config.notifyJobs !== false;
    $('fName').value = st.foreman.name;
    $('fSpecies').value = st.foreman.species;
    return st;
  }

  $('recheck').addEventListener('click', async () => {
    $('cli-status').textContent = 'checking…';
    const cli = await window.settings.recheck();
    showCli(cli);
    flash($('cli-msg'), cli.ready ? 'Claude Code is ready.' : 'Not ready yet. See above.', cli.ready);
  });
  $('save-path').addEventListener('click', async () => {
    await window.settings.saveConfig({ claudePath: $('cli-path').value });
    const st = await load();
    flash($('cli-msg'), st.cli.found ? 'Path saved.' : 'Saved, but no claude.exe there.', st.cli.found);
  });
  window.settings.onCliStatus(showCli);

  $('save-models').addEventListener('click', async () => {
    await window.settings.saveConfig({ model: $('model').value, quickModel: $('quickModel').value, deepModel: $('deepModel').value });
    flash($('cfg-msg'), 'Models saved.', true);
  });
  $('save-foreman').addEventListener('click', async () => {
    await window.settings.setForeman({ name: $('fName').value.trim() || 'Marmalade', species: $('fSpecies').value });
    flash($('cfg-msg'), 'Foreman saved.', true);
  });
  $('roam').addEventListener('change', async () => {
    await window.settings.saveConfig({ roam: $('roam').checked });
    flash($('cfg-msg'), 'Saved.', true);
  });

  $('notifyJobs').addEventListener('change', async () => {
    await window.settings.saveConfig({ notifyJobs: $('notifyJobs').checked });
    flash($('cfg-msg'), 'Saved.', true);
  });

  $('import').addEventListener('click', async () => {
    flash($('import-msg'), 'Choose a file…', true);
    const r = await window.settings.importData();
    if (r.ok) flash($('import-msg'), `Imported (${r.mode}): ${r.summary}.`, true);
    else if (r.canceled) flash($('import-msg'), 'Import canceled. Nothing changed.', true);
    else flash($('import-msg'), r.error || 'Import failed.', false);
    load();
  });
  $('open-data').addEventListener('click', () => window.settings.openDataFolder());

  load();
})();
