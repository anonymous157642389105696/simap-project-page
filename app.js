const PALETTE = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#17becf', '#bcbd22', '#393b79',
  '#637939', '#8c6d31', '#843c39', '#7b4173', '#3182bd',
  '#31a354', '#756bb1', '#636363', '#e6550d', '#9c9ede'
];

function colorForCluster(clusterId) {
  const id = Number(clusterId);
  if (!Number.isFinite(id) || id < 0) return '#7f8c8d';
  return PALETTE[id % PALETTE.length];
}

function parseClusterId(raw) {
  if (raw === null || raw === undefined) return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

function parseLevel(raw) {
  if (raw === null || raw === undefined) return null;
  const level = Number(raw);
  if (!Number.isFinite(level)) return null;
  return Math.trunc(level);
}

function normalizeLabel(label) {
  if (label === null || label === undefined) return '(empty)';
  const text = String(label).trim();
  if (!text || text === '""' || text.toLowerCase() === 'null') return '(empty)';
  return text;
}

function truncateLabel(text, maxLen = 40) {
  return text.length <= maxLen ? text : `${text.slice(0, maxLen - 3)}...`;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function rectsOverlap(a, b, pad = 4) {
  return !(
    a.r + pad < b.l ||
    a.l - pad > b.r ||
    a.b + pad < b.t ||
    a.t - pad > b.b
  );
}

function zoomedRange(min, max, factor = 0.5) {
  const center = (min + max) / 2;
  const span = Math.max(1e-9, (max - min) * factor);
  return [center - span / 2, center + span / 2];
}

async function draw() {
  const meta = document.getElementById('meta');
  const errorBox = document.getElementById('error');
  const nsynthL1Toggle = document.getElementById('toggle-nsynth-l1');
  const nsynthL2Toggle = document.getElementById('toggle-nsynth-l2');
  const nsynthL3Toggle = document.getElementById('toggle-nsynth-l3');
  const repsToggle = document.getElementById('toggle-reps');

  try {
    const res = await fetch('text_label_distribution.json');
    if (!res.ok) {
      throw new Error(`Failed to load text_label_distribution.json (HTTP ${res.status})`);
    }

    const points = await res.json();
    if (!Array.isArray(points)) {
      throw new Error('Expected JSON array of points.');
    }

    const grouped = new Map();
    const nsynthLevels = new Map([
      [1, { x: [], y: [], labels: [] }],
      [2, { x: [], y: [], labels: [] }],
      [3, { x: [], y: [], labels: [] }]
    ]);
    let nsynthUnknownLevelHidden = 0;
    let simapNoiseHidden = 0;

    for (const point of points) {
      const x = Number(point.x);
      const y = Number(point.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      const sourceRaw = point && point.source !== undefined ? String(point.source) : 'simap';
      const source = sourceRaw.toLowerCase();
      const label = normalizeLabel(point.label);

      if (source.includes('nsynth')) {
        const level = parseLevel(point.level);
        const bucket = nsynthLevels.get(level);
        if (!bucket) {
          nsynthUnknownLevelHidden++;
          continue;
        }
        bucket.x.push(x);
        bucket.y.push(y);
        bucket.labels.push(label);
        continue;
      }

      const cluster = parseClusterId(point.cluster);
      if (cluster === null || cluster === -1) {
        simapNoiseHidden++;
        continue;
      }

      if (!grouped.has(cluster)) {
        grouped.set(cluster, { x: [], y: [], labels: [] });
      }
      const bucket = grouped.get(cluster);
      bucket.x.push(x);
      bucket.y.push(y);
      bucket.labels.push(label);
    }

    const sortedClusters = Array.from(grouped.keys()).sort((a, b) => {
      if (a === -1) return 1;
      if (b === -1) return -1;
      return a - b;
    });

    const traces = sortedClusters.map((clusterId) => {
      const group = grouped.get(clusterId);
      const isNoise = clusterId === -1;

      return {
        type: 'scattergl',
        mode: 'markers',
        name: isNoise ? 'Noise (cluster -1)' : `Cluster ${clusterId}`,
        x: group.x,
        y: group.y,
        text: group.labels,
        customdata: Array(group.x.length).fill(clusterId),
        marker: {
          size: 7,
          opacity: 0.38,
          color: isNoise ? '#7f8c8d' : colorForCluster(clusterId)
        },
        hovertemplate:
          'source: simap<br>' +
          'cluster: %{customdata}<br>' +
          'label: %{text}<br>' +
          'x: %{x:.4f}<br>' +
          'y: %{y:.4f}<extra></extra>'
      };
    });

    const nsynthTraceNames = new Map([
      [1, 'NSynth-777 (level 1)'],
      [2, 'NSynth-777 (level 2)'],
      [3, 'NSynth-777 (level 3)']
    ]);

    const nsynthLevelStyles = new Map([
      [1, { color: '#111827', size: 10 }],
      [2, { color: '#2563eb', size: 11 }],
      [3, { color: '#7c3aed', size: 12 }]
    ]);

    for (const level of [1, 2, 3]) {
      const bucket = nsynthLevels.get(level);
      const name = nsynthTraceNames.get(level);
      const style = nsynthLevelStyles.get(level);
      traces.push({
        type: 'scattergl',
        mode: 'markers',
        name,
        x: bucket.x,
        y: bucket.y,
        text: bucket.labels,
        customdata: Array(bucket.x.length).fill(level),
        marker: {
          symbol: 'x',
          size: style.size,
          color: style.color,
          opacity: 1,
          line: { width: 1 }
        },
        visible: false,
        hovertemplate:
          'source: NSynth-777 level %{customdata}<br>' +
          'label: %{text}<br>' +
          'x: %{x:.4f}<br>' +
          'y: %{y:.4f}<extra></extra>'
      });
    }

    const representatives = [];

    for (const clusterId of sortedClusters) {
      const group = grouped.get(clusterId);
      if (!group || group.x.length === 0) continue;

      let cx = 0;
      let cy = 0;
      for (let i = 0; i < group.x.length; i++) {
        cx += group.x[i];
        cy += group.y[i];
      }
      cx /= group.x.length;
      cy /= group.y.length;

      let bestIdx = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < group.x.length; i++) {
        const dx = group.x[i] - cx;
        const dy = group.y[i] - cy;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < bestDist) {
          bestDist = dist2;
          bestIdx = i;
        }
      }

      representatives.push({
        clusterId,
        x: group.x[bestIdx],
        y: group.y[bestIdx],
        label: group.labels[bestIdx],
        color: colorForCluster(clusterId),
        size: group.x.length
      });
    }

    const plottedCount = sortedClusters.reduce((sum, id) => sum + grouped.get(id).x.length, 0);
    const nsynthL1Count = nsynthLevels.get(1).x.length;
    const nsynthL2Count = nsynthLevels.get(2).x.length;
    const nsynthL3Count = nsynthLevels.get(3).x.length;
    meta.textContent =
      `${plottedCount.toLocaleString()} SIMAP plotted points | ` +
      `${sortedClusters.length} clusters | ` +
      `${simapNoiseHidden.toLocaleString()} SIMAP noise points hidden | ` +
      `NSynth-777: ` +
      `L1 ${nsynthL1Count.toLocaleString()}, ` +
      `L2 ${nsynthL2Count.toLocaleString()}, ` +
      `L3 ${nsynthL3Count.toLocaleString()} (toggle to show)` +
      (nsynthUnknownLevelHidden ? ` | ${nsynthUnknownLevelHidden.toLocaleString()} NSynth points with unknown level hidden` : '');

    let xMin = Number.POSITIVE_INFINITY;
    let xMax = Number.NEGATIVE_INFINITY;
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;
    for (const clusterId of sortedClusters) {
      const group = grouped.get(clusterId);
      for (let i = 0; i < group.x.length; i++) {
        const x = group.x[i];
        const y = group.y[i];
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }

    const layout = {
      margin: { t: 30, r: 20, b: 60, l: 60 },
      paper_bgcolor: '#ffffff',
      plot_bgcolor: '#ffffff',
      dragmode: 'pan',
      xaxis: {
        title: 'x',
        range: zoomedRange(xMin, xMax, 0.42),
        gridcolor: '#eef2f7',
        zerolinecolor: '#dbe3ee'
      },
      yaxis: {
        title: 'y',
        range: zoomedRange(yMin, yMax, 0.42),
        scaleanchor: 'x',
        scaleratio: 1,
        gridcolor: '#eef2f7',
        zerolinecolor: '#dbe3ee'
      },
      showlegend: false,
      hoverlabel: {
        bgcolor: '#111827',
        font: { color: '#ffffff' }
      }
    };

    const config = {
      responsive: true,
      scrollZoom: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d']
    };

    await Plotly.newPlot('plot', traces, layout, config);

    const plotEl = document.getElementById('plot');
    const markerTraceCount = sortedClusters.length;
    const baseOpacity = 0.38;
    const baseSize = 7;
    let highlightedTraceIndex = -1;

    let showRepresentativeLabels = true;
    if (repsToggle) {
      const updateToggleLabel = (isVisible) => {
        repsToggle.textContent = isVisible ? 'Hide SIMAP cluster representatives' : 'Show SIMAP cluster representatives';
        repsToggle.setAttribute('aria-pressed', isVisible ? 'true' : 'false');
      };

      updateToggleLabel(true);

      repsToggle.addEventListener('click', () => {
        showRepresentativeLabels = !showRepresentativeLabels;
        updateToggleLabel(showRepresentativeLabels);

        if (showRepresentativeLabels) {
          applyRepresentativeAnnotations();
          return;
        }

        isApplyingAnnotations = true;
        Plotly.relayout(plotEl, { annotations: [] })
          .then(() => { isApplyingAnnotations = false; })
          .catch(() => { isApplyingAnnotations = false; });
      });
    }

    const nsynthButtonsByLevel = new Map([
      [1, nsynthL1Toggle],
      [2, nsynthL2Toggle],
      [3, nsynthL3Toggle]
    ]);

    const nsynthLevelDescriptions = new Map([
      [1, 'Family'],
      [2, 'Family+Source'],
      [3, 'Family+Source+Quality']
    ]);

    const nsynthButtonLabel = (level) => {
      const desc = nsynthLevelDescriptions.get(level);
      return desc ? `NSynth-777 level ${level}: ${desc}` : `NSynth-777 level ${level}`;
    };

    const findNsynthTraceIndex = (level) => {
      const name = nsynthTraceNames.get(level);
      if (!name) return -1;
      return plotEl.data.findIndex((t) => t && t.name === name);
    };

    const setupNsynthToggle = (level) => {
      const btn = nsynthButtonsByLevel.get(level);
      if (!btn) return;

      const updateToggleLabel = (isVisible) => {
        const base = nsynthButtonLabel(level);
        btn.textContent = isVisible ? `Hide ${base}` : `Show ${base}`;
        btn.setAttribute('aria-pressed', isVisible ? 'true' : 'false');
      };

      updateToggleLabel(false);
      btn.disabled = nsynthLevels.get(level).x.length === 0;

      btn.addEventListener('click', () => {
        const idx = findNsynthTraceIndex(level);
        if (idx === -1) return;
        const trace = plotEl.data && plotEl.data[idx];
        const currentlyVisible = trace && trace.visible !== false;
        const nextVisible = !currentlyVisible;
        updateToggleLabel(nextVisible);
        Plotly.restyle(plotEl, { visible: nextVisible }, [idx]);
      });
    };

    setupNsynthToggle(1);
    setupNsynthToggle(2);
    setupNsynthToggle(3);

    function resetTrace(traceIndex) {
      if (traceIndex < 0 || traceIndex >= markerTraceCount) return;
      Plotly.restyle(
        plotEl,
        {
          'marker.opacity': baseOpacity,
          'marker.size': baseSize
        },
        [traceIndex]
      );
    }

    function highlightTrace(traceIndex) {
      if (traceIndex < 0 || traceIndex >= markerTraceCount) return;
      if (highlightedTraceIndex === traceIndex) return;

      if (highlightedTraceIndex !== -1) {
        resetTrace(highlightedTraceIndex);
      }

      Plotly.restyle(
        plotEl,
        {
          'marker.opacity': 0.95,
          'marker.size': 8
        },
        [traceIndex]
      );
      highlightedTraceIndex = traceIndex;
    }

    plotEl.on('plotly_hover', (evt) => {
      const pt = evt && evt.points && evt.points[0];
      if (!pt || pt.curveNumber >= markerTraceCount) return;
      highlightTrace(pt.curveNumber);
    });

    plotEl.on('plotly_unhover', () => {
      if (highlightedTraceIndex !== -1) {
        resetTrace(highlightedTraceIndex);
        highlightedTraceIndex = -1;
      }
    });

    let isApplyingAnnotations = false;
    function applyRepresentativeAnnotations() {
      if (!showRepresentativeLabels) return;
      const fullLayout = plotEl._fullLayout;
      if (!fullLayout || !fullLayout.xaxis || !fullLayout.yaxis) return;

      const xa = fullLayout.xaxis;
      const ya = fullLayout.yaxis;
      const plotLeft = xa._offset;
      const plotRight = xa._offset + xa._length;
      const plotTop = ya._offset;
      const plotBottom = ya._offset + ya._length;

      const candidates = [
        [0, -28], [22, -22], [-22, -22], [30, 0], [-30, 0],
        [22, 22], [-22, 22], [0, 28], [40, -10], [-40, -10]
      ];

      const placedRects = [];
      const annotations = [];
      const repsByPriority = [...representatives].sort((a, b) => b.size - a.size);

      for (const rep of repsByPriority) {
        const px = xa.l2p(rep.x) + xa._offset;
        const py = ya.l2p(rep.y) + ya._offset;
        const shortText = `C${rep.clusterId}: ${truncateLabel(rep.label, 44)}`;
        const textW = Math.max(90, Math.min(360, shortText.length * 6.6 + 18));
        const textH = 24;

        let chosen = [0, -28];
        let chosenRect = {
          l: px - textW / 2,
          r: px + textW / 2,
          t: py - 28 - textH / 2,
          b: py - 28 + textH / 2
        };

        for (const [dx, dy] of candidates) {
          const cx = px + dx;
          const cy = py + dy;
          const rect = {
            l: cx - textW / 2,
            r: cx + textW / 2,
            t: cy - textH / 2,
            b: cy + textH / 2
          };

          if (
            rect.l < plotLeft + 2 ||
            rect.r > plotRight - 2 ||
            rect.t < plotTop + 2 ||
            rect.b > plotBottom - 2
          ) {
            continue;
          }

          let overlaps = false;
          for (const used of placedRects) {
            if (rectsOverlap(rect, used, 4)) {
              overlaps = true;
              break;
            }
          }
          if (!overlaps) {
            chosen = [dx, dy];
            chosenRect = rect;
            break;
          }
        }

        placedRects.push(chosenRect);
        annotations.push({
          x: rep.x,
          y: rep.y,
          xref: 'x',
          yref: 'y',
          text: escapeHtml(shortText),
          showarrow: true,
          axref: 'pixel',
          ayref: 'pixel',
          ax: chosen[0],
          ay: chosen[1],
          arrowhead: 0,
          arrowwidth: 1,
          arrowcolor: rep.color,
          bgcolor: 'rgba(255,255,255,0.92)',
          bordercolor: rep.color,
          borderwidth: 1,
          borderpad: 3,
          opacity: 0.98,
          font: {
            size: 11,
            color: '#111827'
          },
          align: 'left',
          hovertext: `cluster: ${rep.clusterId}<br>representative label: ${escapeHtml(rep.label)}`
        });
      }

      isApplyingAnnotations = true;
      Plotly.relayout(plotEl, { annotations })
        .then(() => { isApplyingAnnotations = false; })
        .catch(() => { isApplyingAnnotations = false; });
    }

    plotEl.on('plotly_relayout', () => {
      if (isApplyingAnnotations || !showRepresentativeLabels) return;
      applyRepresentativeAnnotations();
    });

    applyRepresentativeAnnotations();
  } catch (err) {
    errorBox.style.display = 'block';
    errorBox.textContent = `Could not render chart.\n\n${err.message}\n\nTip: run a local server (for example: python3 -m http.server 8000) and open http://localhost:8000`;
    meta.textContent = 'Failed to load data.';
  }
}

draw();
