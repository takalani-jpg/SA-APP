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
    downloadworkerfile: 'https://cdn.jsdelivr.net/npm/@m-lab/ndt7@0.13.0/dist/ndt7-download-worker.min.js',
    uploadworkerfile: 'https://cdn.jsdelivr.net/npm/@m-lab/ndt7@0.13.0/dist/ndt7-upload-worker.min.js',
  };

  startBtn.addEventListener('click', async () => {
    if (running) return;
    ignoreUpdates = false;
    setRunning(true);
    resetUI();

    let chosenServer = null;

    const callbacks = {
      error: (err) => {
        if (ignoreUpdates) return;
        serverInfoEl.textContent = `Error: ${err}`;
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
      },
      uploadComplete: () => {
        if (ignoreUpdates) return;
        setRunning(false);
        const latencyText = latencyEl.textContent.replace(' ms','');
        addHistoryItem(lastDownload, lastUpload, latencyText === '—' ? undefined : parseInt(latencyText,10));
      },
    };

    try{
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
