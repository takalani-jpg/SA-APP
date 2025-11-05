(function(){
  const gaugeValEl = document.getElementById('gaugeValue');
  const downloadEl = document.getElementById('downloadMbps');
  const uploadEl = document.getElementById('uploadMbps');
  const latencyEl = document.getElementById('latencyMs');
  const serverInfoEl = document.getElementById('serverInfo');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const themeToggle = document.getElementById('themeToggle');
  const historyList = document.getElementById('historyList');

  let running = false;
  let ignoreUpdates = false;
  let lastDownload = 0;
  let lastUpload = 0;
  let safetyTimer = null;

  // Theme toggle between gradient and solid background
  themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('gradient');
  });

  function formatMbps(v){
    if(!isFinite(v)) return '0.0';
    return (Math.round(v*10)/10).toFixed(1);
  }

  function setGauge(mbps){
    gaugeValEl.textContent = formatMbps(mbps);
  }

  async function preflightLocate(maxAttempts = 3){
    // If manual server override is set, skip locate
    if (ndtConfig.server){
      return { ok: true, data: { override: ndtConfig.server } };
    }
    const url = 'https://locate.measurementlab.net/v2/nearest/ndt/ndt7';
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++){
      try{
        const res = await fetch(url, { cache: 'no-store' });
        const js = await res.json().catch(()=>({}));
        if (res.ok && js && Array.isArray(js.results)){
          return { ok: true, data: js };
        }
        lastError = js && js.error ? js.error : { status: res.status, body: js };
      }catch(e){
        lastError = e;
      }
      // exponential backoff with jitter
      const delay = Math.min(30000, attempt * 2000) + Math.floor(Math.random()*500);
      await new Promise(r=>setTimeout(r, delay));
    }
    return { ok: false, error: lastError };
  }

  async function measureLatency(iterations = 5){
    try{
      const url = 'https://www.gstatic.com/generate_204';
      const times = [];
      for(let i=0;i<iterations;i++){
        const t0 = performance.now();
        await fetch(url, { cache: 'no-store', mode: 'no-cors' });
        const t1 = performance.now();
        times.push(t1 - t0);
      }
      const avg = times.reduce((a,b)=>a+b,0)/times.length;
      latencyEl.textContent = `${Math.round(avg)} ms`;
    }catch(e){
      latencyEl.textContent = '— ms';
    }
  }

  function resetUI(){
    setGauge(0);
    downloadEl.textContent = '0.0 Mbps';
    uploadEl.textContent = '0.0 Mbps';
    serverInfoEl.textContent = 'Server: —';
    latencyEl.textContent = '— ms';
  }

  function setRunning(state){
    running = state;
    startBtn.disabled = state;
    stopBtn.disabled = !state;
  }

  function addHistoryItem(downloadMbps, uploadMbps, latencyMs){
    const li = document.createElement('li');
    const time = new Date().toLocaleString();
    li.textContent = `${time} • Down ${formatMbps(downloadMbps)} Mbps • Up ${formatMbps(uploadMbps)} Mbps • Latency ${latencyMs || '—'} ms`;
    historyList.prepend(li);
  }

  // NDT7 configuration
  const ndtConfig = {
    userAcceptedDataPolicy: true,
    // Workers must be absolute URLs when using the library from a CDN
    downloadworkerfile: 'https://cdn.jsdelivr.net/npm/@m-lab/ndt7@0.0.6/src/ndt7-download-worker.min.js',
    uploadworkerfile: 'https://cdn.jsdelivr.net/npm/@m-lab/ndt7@0.0.6/src/ndt7-upload-worker.min.js',
    // Force ndt7 to use our cached proxy to avoid direct 429s
    loadbalancer: 'https://locate.measurementlab.net/v2/nearest/ndt/ndt7',
  };

  // Optional manual server override via ?server=hostname
  try{
    const sp = new URLSearchParams(location.search);
    const serverOverride = sp.get('server');
    if (serverOverride && /^[a-z0-9.-]+$/i.test(serverOverride)){
      ndtConfig.server = serverOverride;
    }
  }catch{}

  startBtn.addEventListener('click', async () => {
    if (running) return;
    ignoreUpdates = false;
    setRunning(true);
    resetUI();

    let chosenServer = null;

    if (safetyTimer) clearTimeout(safetyTimer);
    safetyTimer = setTimeout(() => {
      if (running && lastDownload === 0 && lastUpload === 0) {
        serverInfoEl.textContent = 'Error: timeout waiting for measurements';
        setRunning(false);
      }
    }, 45000);

    const callbacks = {
      error: (err) => {
        if (ignoreUpdates) return;
        const msg = (typeof err === 'object') ? JSON.stringify(err) : String(err);
        serverInfoEl.textContent = `Error: ${msg}`;
        if (safetyTimer) clearTimeout(safetyTimer);
        setRunning(false);
      },
      serverDiscovery: () => {
        serverInfoEl.textContent = 'Finding best server…';
      },
      serverChosen: (choice) => {
        chosenServer = choice;
        const city = choice && choice.location && choice.location.city ? choice.location.city : '—';
        const site = choice && choice.site ? choice.site : '';
        serverInfoEl.textContent = `Server: ${city} ${site ? '('+site+')' : ''}`;
        // Kick off a basic latency measurement while download starts
        measureLatency(5);
      },
      downloadStart: () => {},
      downloadMeasurement: (m) => {
        if (ignoreUpdates) return;
        if (m && m.Source === 'client' && m.Data && typeof m.Data.MeanClientMbps === 'number'){
          lastDownload = m.Data.MeanClientMbps;
          setGauge(lastDownload);
          downloadEl.textContent = `${formatMbps(lastDownload)} Mbps`;
        }
        // Prefer server-reported TCPInfo MinRTT for latency when available (microseconds -> ms)
        if (m && m.Source === 'server' && m.Data && m.Data.TCPInfo && typeof m.Data.TCPInfo.MinRTT === 'number'){
          const rttUs = m.Data.TCPInfo.MinRTT;
          const rttMs = Math.max(0, Math.round(rttUs / 1000));
          latencyEl.textContent = `${rttMs} ms`;
        }
      },
      downloadComplete: () => {},
      uploadStart: () => {},
      uploadMeasurement: (m) => {
        if (ignoreUpdates) return;
        if (m && m.Source === 'client' && m.Data && typeof m.Data.MeanClientMbps === 'number'){
          lastUpload = m.Data.MeanClientMbps;
          uploadEl.textContent = `${formatMbps(lastUpload)} Mbps`;
          // Show current phase on the gauge as well
          setGauge(lastUpload);
        }
        // Prefer server-reported TCPInfo MinRTT for latency when available (microseconds -> ms)
        if (m && m.Source === 'server' && m.Data && m.Data.TCPInfo && typeof m.Data.TCPInfo.MinRTT === 'number'){
          const rttUs = m.Data.TCPInfo.MinRTT;
          const rttMs = Math.max(0, Math.round(rttUs / 1000));
          latencyEl.textContent = `${rttMs} ms`;
        }
      },
      uploadComplete: () => {
        if (ignoreUpdates) return;
        if (safetyTimer) clearTimeout(safetyTimer);
        setRunning(false);
        const latencyText = latencyEl.textContent.replace(' ms','');
        addHistoryItem(lastDownload, lastUpload, latencyText === '—' ? undefined : parseInt(latencyText,10));
      },
    };

    try{
      // Preflight locate to avoid opaque errors like [object Object]
      serverInfoEl.textContent = 'Finding best server…';
      const locate = await preflightLocate(5);
      if (!locate.ok){
        const msg = (typeof locate.error === 'object') ? JSON.stringify(locate.error) : String(locate.error);
        throw new Error(`Locate failed: ${msg}${ndtConfig.server ? '' : ' | Tip: add ?server=HOSTNAME to the URL to bypass locate.'}`);
      }
      // Run combined test (download then upload)
      const rc = await window.ndt7.test(ndtConfig, callbacks);
      // rc==0 means success; non-zero already handled via error callback.
    }catch(e){
      callbacks.error(e && e.message ? e.message : String(e));
    }
  });

  stopBtn.addEventListener('click', () => {
    if (!running) return;
    // The ndt7 library doesn't expose a cancellation handle for the internal workers.
    // We stop updating the UI and let the workers time out quickly.
    ignoreUpdates = true;
    setRunning(false);
    serverInfoEl.textContent = 'Stopping…';
    setTimeout(() => {
      serverInfoEl.textContent = 'Stopped';
    }, 800);
  });
})();
