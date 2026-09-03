
const SCRIPT_URL = '/api/proxy';
let offlineQueue = JSON.parse(localStorage.getItem('offlineQueue') || '[]');

window.addEventListener('online', syncOfflineQueue);
window.addEventListener('offline', () => alert('Estás sin conexión. Los cambios se guardarán localmente.'));

const WRITE_ACTIONS = ['guardarEvento','editarEvento','borrarEvento','guardarSubtarea','editarSubtarea','borrarSubtarea','cambiarEstadoSubtarea','generarPDF','generarReporteBusqueda'];

async function apiCall(action, data = null, timeoutMs = 20000) {
  if (!navigator.onLine) {
    if (WRITE_ACTIONS.includes(action)) {
      offlineQueue.push({ action, data });
      localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
      return { success: true, offline: true };
    } else {
      const cached = localStorage.getItem('cache_' + action);
      if (cached) {
        console.log(`Cargando ${action} desde caché local (offline)...`);
        return { success: true, result: JSON.parse(cached), offline: true };
      }
      throw new Error('Estás offline. No hay datos guardados para mostrar.');
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response;
    if (WRITE_ACTIONS.includes(action)) {
      response = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, data }),
        signal: controller.signal
      });
    } else {
      const params = new URLSearchParams({ action });
      if (data) params.append('data', JSON.stringify(data));
      response = await fetch(`${SCRIPT_URL}?${params.toString()}`, {
        method: 'GET',
        signal: controller.signal
      });
    }
    clearTimeout(timer);
    if (!response.ok) throw new Error('Error en red: ' + response.statusText);
    const result = await response.json();
    if (!result.success) throw new Error(result.error);
    
    if (!WRITE_ACTIONS.includes(action)) {
      localStorage.setItem('cache_' + action, JSON.stringify(result.result));
    }
    
    return result;
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Tiempo de espera agotado (20s). El servidor tardó demasiado.');
    console.error("Error en apiCall (probablemente sin internet):", e);
    
    if (WRITE_ACTIONS.includes(action)) {
      // Guardar en cola offline si la petición de escritura falla por falta de internet
      console.warn(`Petición fallida para ${action}, guardando en cola offline...`);
      offlineQueue.push({ action, data });
      localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
      return { success: true, offline: true };
    } else {
      // Intentar cargar desde caché para peticiones de lectura
      const cached = localStorage.getItem('cache_' + action);
      if (cached) {
        console.warn(`Falló la red para ${action}. Cargando desde caché...`);
        return { success: true, result: JSON.parse(cached), offline: true };
      }
    }
    
    throw e;
  }
}

async function syncOfflineQueue() {
  if (offlineQueue.length === 0) return;
  alert('Conexión restaurada. Sincronizando ' + offlineQueue.length + ' cambios pendientes...');
  
  while (offlineQueue.length > 0) {
    const task = offlineQueue[0];
    try {
      let response;
      if (WRITE_ACTIONS.includes(task.action)) {
        response = await fetch(SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: task.action, data: task.data })
        });
      } else {
        const params = new URLSearchParams({ action: task.action });
        if (task.data) params.append('data', JSON.stringify(task.data));
        response = await fetch(`${SCRIPT_URL}?${params.toString()}`, { method: 'GET' });
      }
      
      const result = await response.json();
      if (result.success) {
        offlineQueue.shift();
        localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
      } else {
        console.error("Error sincronizando:", result.error);
        break; 
      }
    } catch (e) {
      console.error("Fallo de red en sync:", e);
      break; 
    }
  }
  
  if (offlineQueue.length === 0) {
    alert('Sincronización completa.');
    cargarDatosIniciales();
  }
}

async function cargarDatosIniciales() {
  mostrarLoader('Cargando desde la nube (PWA)...');
  try {
    const res = await apiCall('getEventos');
    eventosActuales = res.result || [];
    renderEventos();
    renderCalendar();
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('main-view').classList.remove('hidden');
    document.getElementById('form-view').classList.add('hidden');
    document.getElementById('detalle-view').classList.add('hidden');
  } catch (err) {
    console.error(err);
    document.getElementById('loader').classList.add('hidden');
    alert('Error cargando eventos:\n\n' + err.message);
    return;
  }
  // Load all subtareas once and cache — no more per-event calls
  try {
    const res3 = await apiCall('getAllSubtareas');
    if (res3.result) todasLasSubtareas = res3.result;
  } catch (e) {
    console.warn('No se pudieron precargar subtareas:', e.message);
  }
  // Load responsables in background
  try {
    const res2 = await apiCall('getResponsablesUnicos');
    const datalist = document.getElementById('responsables-list');
    if (datalist && res2.result) {
      datalist.innerHTML = '';
      res2.result.forEach(r => {
        let opt = document.createElement('option');
        opt.value = r;
        datalist.appendChild(opt);
      });
    }
  } catch (e) {
    console.warn('No se pudieron cargar responsables:', e.message);
  }
}


  let eventosActuales = [];
  let todasLasSubtareas = [];   // Cache global de subtareas
  let currentEventoData = null;
  let editandoEventoId = null;
  let editandoSubtareaId = null;
  let queryActual = "";
  
  // Variables y Lógica de EnumList Asistentes
  let asistentesArray = [];

  function handleAsistenteInput(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      let val = e.target.value.trim();
      if(val.endsWith(',')) val = val.slice(0, -1).trim();
      if (val && !asistentesArray.includes(val)) {
        asistentesArray.push(val);
        renderChips();
      }
      e.target.value = '';
    }
  }

  function removeAsistente(index) {
    asistentesArray.splice(index, 1);
    renderChips();
  }

  function renderChips() {
    const container = document.getElementById('asistentes-chips');
    container.innerHTML = '';
    asistentesArray.forEach((asistente, i) => {
      container.innerHTML += `<div class="chip">${asistente} <span onclick="removeAsistente(${i})">✖</span></div>`;
    });
    document.getElementById('asistentes').value = asistentesArray.join(', ');
  }
  
  // Variables y Lógica de EnumList Responsable (Subtareas)
  let responsablesArray = [];

  function handleRespInput(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      let val = e.target.value.trim();
      if(val.endsWith(',')) val = val.slice(0, -1).trim();
      if (val && !responsablesArray.includes(val)) {
        responsablesArray.push(val);
        renderRespChips();
      }
      e.target.value = '';
    }
  }

  function removeResp(index) {
    responsablesArray.splice(index, 1);
    renderRespChips();
  }

  function renderRespChips() {
    const container = document.getElementById('sub-resp-chips');
    container.innerHTML = '';
    responsablesArray.forEach((resp, i) => {
      container.innerHTML += `<div class="chip" style="background:#e67e22;">${resp} <span onclick="removeResp(${i})">✖</span></div>`;
    });
    document.getElementById('sub-resp').value = responsablesArray.join(', ');
  }
  
  // Variables y Lógica de EnumList Referencia (Subtareas)
  let referenciasArray = [];

  function handleRefInput(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      let val = e.target.value.trim();
      if(val.endsWith(',')) val = val.slice(0, -1).trim();
      if (val && !referenciasArray.includes(val)) {
        referenciasArray.push(val);
        renderRefChips();
      }
      e.target.value = '';
    }
  }

  function removeRef(index) {
    referenciasArray.splice(index, 1);
    renderRefChips();
  }

  function renderRefChips() {
    const container = document.getElementById('sub-ref-chips');
    container.innerHTML = '';
    referenciasArray.forEach((ref, i) => {
      container.innerHTML += `<div class="chip" style="background:#9b59b6;">${ref} <span onclick="removeRef(${i})">✖</span></div>`;
    });
    document.getElementById('sub-ref').value = referenciasArray.join(', ');
  }
  
  // Variables del Cronómetro
  let activeTimerId = null;
  let activeTimerInterval = null;
  let activeTimerSecondsLeft = 0;
  let activeTimerTotalSeconds = 0;

  window.onload = function() { 
    cargarDatosIniciales();
  };

  function mostrarLoader(msg) {
    document.getElementById('loader').innerText = msg || "Cargando...";
    document.getElementById('loader').classList.remove('hidden');
    document.getElementById('main-view').classList.add('hidden');
    document.getElementById('form-view').classList.add('hidden');
    document.getElementById('detalle-view').classList.add('hidden');
    if(activeTimerInterval) clearInterval(activeTimerInterval);
  }

  

  function cargarEventos() {
    apiCall('getEventos').then(r => {
      eventosActuales = r.result;
      renderEventos();
      renderCalendar();
      document.getElementById('loader').classList.add('hidden');
      document.getElementById('main-view').classList.remove('hidden');
    }).catch(err => {
      document.getElementById('loader').innerText = "⚠️ Error: " + err.message;
      document.getElementById('loader').style.color = "red";
    });
  }

  function renderEventos() {
    const div = document.getElementById('eventos-list');
    div.innerHTML = '';
    
    if(eventosActuales.length === 0) {
      if(queryActual !== "") {
         return div.innerHTML = '<p>No se encontraron actividades con esa búsqueda.</p>';
      } else {
         return div.innerHTML = '<p>No hay actividades registradas.</p>';
      }
    }
    
    if(queryActual !== "") {
      div.innerHTML = `<p style="color:#7f8c8d; margin-top:0;"><i>Mostrando resultados para "${queryActual}"...</i></p>`;
    }
    
    eventosActuales.forEach(ev => {
      const fecha = new Date(ev.fechaInicio).toLocaleString();
      let badgeClass = 'badge-tarea';
      if(ev.tipo === 'Evento') badgeClass = 'badge-evento';
      if(ev.tipo === 'Reunión') badgeClass = 'badge-reunion';
      if(ev.tipo === 'GADPSDT') badgeClass = 'badge-gadpsdt';
      
      let syncInfo = ev.calId ? '<p class="sync-status">✅ Sincronizado con Calendar</p>' : '';
      let semaforoTarea = '';
      if(ev.tipo === 'Tarea' && ev.estadoTarea) {
        let cls = ev.estadoTarea === 'Atrasado' ? 'semaforo-rojo' : (ev.estadoTarea === 'Cumplido' ? 'semaforo-verde' : 'semaforo-amarillo');
        semaforoTarea = `<span class="${cls}" style="float: right;">${ev.estadoTarea}</span>`;
      }
      
      let duracionInfo = ((ev.tipo === 'Reunión' || ev.tipo === 'GADPSDT') && ev.duracion > 0) ? `<br><small style="color:#2980b9;">⏱️ Duración: ${ev.duracion} min</small>` : '';
      let ubicacionInfo = ev.ubicacion ? `<br><small style="color:#16a085;">📍 Ubicación: <a href="https://maps.google.com/?q=${encodeURIComponent(ev.ubicacion)}" target="_blank" style="color:#16a085; text-decoration:underline;">${ev.ubicacion}</a></small>` : '';

      let colorTituloEvento = 'inherit';
      if (ev.tipo === 'Tarea' && ev.estadoTarea) {
        colorTituloEvento = ev.estadoTarea === 'Cumplido' ? '#27ae60' : (ev.estadoTarea === 'En camino' ? '#f39c12' : '#e74c3c');
      } else if ((ev.tipo === 'Reunión' || ev.tipo === 'Evento' || ev.tipo === 'GADPSDT') && ev.estadoGlobalSubtareas && ev.estadoGlobalSubtareas !== 'Ninguna') {
        colorTituloEvento = ev.estadoGlobalSubtareas === 'Completas' ? '#27ae60' : '#e74c3c';
      }

      div.innerHTML += `
        <div class="card">
          <div class="card-actions">
            <button class="btn-icon" onclick="editarEventoInit('${ev.id}')" title="Editar">✏️</button>
            <button class="btn-icon" onclick="borrarEvento('${ev.id}')" title="Borrar">🗑️</button>
          </div>
          ${semaforoTarea}
          <span class="badge ${badgeClass}">${ev.tipo}</span>
          <h3 style="margin-top:5px; margin-bottom: 5px; padding-right:60px; color:${colorTituloEvento};">${ev.titulo}</h3>
          <p style="color:#7f8c8d; margin-top: 0;">🗓️ ${fecha} ${duracionInfo} ${ubicacionInfo}</p>
          ${syncInfo}
          <button class="btn" style="margin-top: 10px;" onclick="verDetalle('${ev.id}')">Ver Detalle / Asignar</button>
        </div>`;
    });
  }

  // LOGICA DE VISTAS (LISTA / CALENDARIO)
  let calendarInstance = null;
  let biomagCalendarInstance = null;
  function switchView(viewName) {
    const listBtn = document.getElementById('btn-view-list');
    const calBtn = document.getElementById('btn-view-cal');
    const biomagBtn = document.getElementById('btn-view-biomag');
    
    const listDiv = document.getElementById('eventos-list');
    const calDiv = document.getElementById('calendar-view');
    const biomagDiv = document.getElementById('biomag-view');
    const searchBar = document.querySelector('.search-bar');
    
    listBtn.style.backgroundColor = '#95a5a6';
    calBtn.style.backgroundColor = '#95a5a6';
    if(biomagBtn) biomagBtn.style.backgroundColor = '#95a5a6';
    listDiv.classList.add('hidden');
    calDiv.classList.add('hidden');
    if(biomagDiv) biomagDiv.classList.add('hidden');
    searchBar.classList.add('hidden');

    if (viewName === 'cal') {
      calBtn.style.backgroundColor = '#2c3e50';
      calDiv.classList.remove('hidden');
      searchBar.classList.remove('hidden');
      if (calendarInstance) calendarInstance.render();
    } else if (viewName === 'biomag') {
      if(biomagBtn) biomagBtn.style.backgroundColor = '#2c3e50';
      if(biomagDiv) biomagDiv.classList.remove('hidden');
      cargarCitasBiomagnetic();
    } else {
      listBtn.style.backgroundColor = '#2c3e50';
      listDiv.classList.remove('hidden');
      searchBar.classList.remove('hidden');
    }
  }

  function renderCalendar() {
    const calDiv = document.getElementById('calendar-view');
    if (!calDiv) return;
    
    const calendarEvents = eventosActuales.map(ev => {
      let color = '#e67e22'; // Tarea
      if(ev.tipo === 'Evento') color = '#9b59b6';
      if(ev.tipo === 'Reunión') color = '#34495e';
      if(ev.tipo === 'GADPSDT') color = '#e67e22';
      
      let textColor = '#ffffff';
      if (ev.tipo === 'Tarea' && ev.estadoTarea) {
        textColor = ev.estadoTarea === 'Cumplido' ? '#c8f7c5' : '#ffcdd2'; // Colores claros para contrastar
      } else if ((ev.tipo === 'Reunión' || ev.tipo === 'Evento' || ev.tipo === 'GADPSDT') && ev.estadoGlobalSubtareas && ev.estadoGlobalSubtareas !== 'Ninguna') {
        textColor = ev.estadoGlobalSubtareas === 'Completas' ? '#c8f7c5' : '#ffcdd2';
      }
      
      return {
        id: ev.id,
        title: ev.titulo + ((ev.tipo === 'Reunión' || ev.tipo === 'GADPSDT') && ev.duracion ? ' (' + ev.duracion + 'm)' : ''),
        start: ev.fechaInicio,
        end: ev.fechaFin || ev.fechaInicio,
        backgroundColor: color,
        borderColor: color,
        textColor: textColor
      };
    });
    
    if (calendarInstance) {
      calendarInstance.destroy();
    }
    
    calendarInstance = new FullCalendar.Calendar(calDiv, {
      initialView: 'dayGridMonth',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek'
      },
      buttonText: {
        today: 'Hoy',
        month: 'Mes',
        week: 'Semana',
        day: 'Día',
        list: 'Lista'
      },
      events: calendarEvents,
      eventClick: function(info) {
        verDetalle(info.event.id);
      },
      locale: 'es',
      height: 600
    });
    
    if (!calDiv.classList.contains('hidden')) {
      calendarInstance.render();
    }
  }

  function cargarCitasBiomagnetic() {
    mostrarLoader("Cargando citas Biomagnetic...");
    apiCall('getCitasBiomagnetic').then(r => {
      document.getElementById('loader').classList.add('hidden');
      document.getElementById('main-view').classList.remove('hidden');
      renderBiomagneticCalendar(r.result);
    }).catch(err => {
      document.getElementById('loader').innerText = "⚠️ Error: " + err.message;
      document.getElementById('loader').style.color = "red";
    });
  }

  function renderBiomagneticCalendar(citas) {
    const calDiv = document.getElementById('biomag-calendar-container');
    if (!calDiv) return;
    
    if (biomagCalendarInstance) {
      biomagCalendarInstance.destroy();
    }
    
    biomagCalendarInstance = new FullCalendar.Calendar(calDiv, {
      initialView: 'timeGridWeek',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'timeGridWeek,timeGridDay'
      },
      buttonText: {
        today: 'Hoy',
        week: 'Semana',
        day: 'Día'
      },
      events: citas,
      locale: 'es',
      height: 600,
      slotMinTime: '06:00:00',
      slotMaxTime: '22:00:00'
    });
    
    biomagCalendarInstance.render();
  }

  // BÚSQUEDA 
  function ejecutarBusqueda() {
    let q = document.getElementById('busqueda-input').value.trim();
    if (q === "") return limpiarBusqueda();
    queryActual = q;
    mostrarLoader("Buscando en la base de datos...");
    document.getElementById('btn-limpiar').classList.remove('hidden');
    document.getElementById('btn-print-search').classList.remove('hidden');
    
    apiCall('buscarTodo', q).then(r => {
      eventosActuales = r.result;
      renderEventos();
      document.getElementById('loader').classList.add('hidden');
      document.getElementById('main-view').classList.remove('hidden');
    }).catch(err => {
      alert("Error en la búsqueda: " + err.message);
      limpiarBusqueda();
    });
  }
  
  function limpiarBusqueda() {
    queryActual = "";
    document.getElementById('busqueda-input').value = "";
    document.getElementById('btn-limpiar').classList.add('hidden');
    document.getElementById('btn-print-search').classList.add('hidden');
    
    document.getElementById('btn-save-sub').innerText = "Añadir Subtarea";
    document.getElementById('btn-cancel-sub').classList.add('hidden');
    document.getElementById('sub-estado-container').classList.add('hidden');
    
    // Return form to its original container
    let originalContainer = document.getElementById('subtareas-form-container-original');
    if(originalContainer) {
      originalContainer.appendChild(document.getElementById('panel-subtarea-form'));
    }
    
    cargarDatosIniciales();
  }
  
  function descargarReporteBusqueda() {
    alert("Generando PDF consolidado para '" + queryActual + "'... esto puede tardar unos segundos.");
    apiCall('generarReporteBusqueda', queryActual).then(r => {
      let res = r.result;
      if (res.success && res.base64) {
        const link = document.createElement('a');
        link.href = 'data:application/pdf;base64,' + res.base64;
        link.download = res.filename || 'Busqueda.pdf';
        link.click();
      } else {
        alert("Error: " + res.error);
      }
    }).catch(err => alert("Error generando reporte: " + err.message));
  }

  function toggleFormFields() {
    const tipo = document.getElementById('tipo').value;
    const groupEstado = document.getElementById('group-estado-tarea');
    const extraFields = document.getElementById('extra-fields');
    
    const gfFin = document.getElementById('group-fecha-fin');
    const gDurH = document.getElementById('group-duracion-horas');
    const gDurM = document.getElementById('group-duracion-minutos');
    const gUbi = document.getElementById('group-ubicacion');
    
    if (tipo === 'Tarea') {
      extraFields.classList.add('hidden');
      groupEstado.classList.remove('hidden');
      gfFin.classList.remove('hidden');
      gDurH.classList.add('hidden');
      gDurM.classList.add('hidden');
      gUbi.classList.add('hidden');
    } else if (tipo === 'Reunión' || tipo === 'GADPSDT') {
      extraFields.classList.remove('hidden');
      groupEstado.classList.add('hidden');
      gfFin.classList.add('hidden');
      gDurH.classList.remove('hidden');
      gDurM.classList.remove('hidden');
      gUbi.classList.remove('hidden');
    } else {
      // Evento
      extraFields.classList.remove('hidden');
      groupEstado.classList.add('hidden');
      gfFin.classList.remove('hidden');
      gDurH.classList.add('hidden');
      gDurM.classList.add('hidden');
      gUbi.classList.remove('hidden');
    }
  }

  function openFormEvento(id = null) {
    document.getElementById('main-view').classList.add('hidden');
    document.getElementById('form-view').classList.remove('hidden');
    
    editandoEventoId = id;
    if(id) {
      document.getElementById('form-title').innerText = "Editar Actividad";
      const ev = eventosActuales.find(e => e.id === id);
      document.getElementById('tipo').value = ev.tipo;
      document.getElementById('titulo').value = ev.titulo;
      document.getElementById('fechaInicio').value = ev.fechaInicio.substring(0,16); 
      document.getElementById('fechaFin').value = ev.fechaFin.substring(0,16);
      document.getElementById('ubicacion').value = ev.ubicacion || "";
      
      document.getElementById('asistentes').value = ev.asistentes || "";
      if(ev.asistentes) {
        asistentesArray = ev.asistentes.split(',').map(s => s.trim()).filter(s => s !== "");
      } else {
        asistentesArray = [];
      }
      renderChips();
      document.getElementById('asistentes-input').value = "";
      
      document.getElementById('acuerdos').value = ev.acuerdos || "";
      document.getElementById('estado-tarea').value = ev.estadoTarea === 'Cumplido' ? 'Cumplido' : 'En camino';
      
      let mTotal = parseInt(ev.duracion) || 0;
      document.getElementById('duracion-horas').value = Math.floor(mTotal / 60);
      document.getElementById('duracion-minutos').value = mTotal % 60;
      
    } else {
      document.getElementById('form-title').innerText = "Registrar Nueva Actividad";
      document.getElementById('titulo').value = '';
      document.getElementById('ubicacion').value = '';
      document.getElementById('fechaInicio').value = '';
      document.getElementById('fechaFin').value = '';
      
      document.getElementById('asistentes').value = '';
      asistentesArray = [];
      renderChips();
      document.getElementById('asistentes-input').value = "";
      
      document.getElementById('acuerdos').value = '';
      document.getElementById('estado-tarea').value = 'En camino';
      document.getElementById('duracion-horas').value = 1;
      document.getElementById('duracion-minutos').value = 0;
    }
    toggleFormFields();
  }

  function guardarEventoBtn() {
    // FORCE FLUSH PENDING ASISTENTES INPUT
    const asisInputVal = document.getElementById('asistentes-input').value.trim().replace(',', '');
    if (asisInputVal && !asistentesArray.includes(asisInputVal)) {
      asistentesArray.push(asisInputVal);
      document.getElementById('asistentes').value = asistentesArray.join(', ');
      document.getElementById('asistentes-input').value = '';
    }

    const ev = {
      tipo: document.getElementById('tipo').value,
      titulo: document.getElementById('titulo').value,
      fechaInicio: document.getElementById('fechaInicio').value,
      fechaFin: document.getElementById('fechaFin').value,
      ubicacion: document.getElementById('ubicacion').value,
      asistentes: document.getElementById('asistentes').value,
      acuerdos: document.getElementById('acuerdos').value,
      estadoTarea: document.getElementById('estado-tarea').value,
      duracion: 0
    };
    
    if(!ev.titulo || !ev.fechaInicio) return alert("Título y Fecha de Inicio son obligatorios.");
    
    if (ev.tipo === 'Reunión' || ev.tipo === 'GADPSDT') {
       let h = parseInt(document.getElementById('duracion-horas').value) || 0;
       let m = parseInt(document.getElementById('duracion-minutos').value) || 0;
       ev.duracion = (h * 60) + m;
       if(ev.duracion === 0) return alert("Una reunión debe tener duración mayor a 0.");
       
       let dateInicio = new Date(ev.fechaInicio);
       dateInicio.setMinutes(dateInicio.getMinutes() + ev.duracion);
       // Setear la fechaFin para el calendario, formateada como YYYY-MM-DDTHH:mm
       ev.fechaFin = dateInicio.getFullYear() + '-' + 
         String(dateInicio.getMonth() + 1).padStart(2, '0') + '-' + 
         String(dateInicio.getDate()).padStart(2, '0') + 'T' + 
         String(dateInicio.getHours()).padStart(2, '0') + ':' + 
         String(dateInicio.getMinutes()).padStart(2, '0');
    } else {
       if(!ev.fechaFin) return alert("La fecha de fin es obligatoria.");
    }
    
    mostrarLoader("Guardando actividad...");
    if(editandoEventoId) {
      ev.id = editandoEventoId;
      apiCall('editarEvento', ev).then(r => {
        let res = r.result;
        if(res && res.error) { 
           alert(res.conflict ? res.error : "Error: " + res.error); 
           if(!res.conflict) showMain(); 
           else {
             document.getElementById('loader').classList.add('hidden');
             document.getElementById('form-view').classList.remove('hidden');
           }
        }
        else { if (queryActual) ejecutarBusqueda(); else cargarDatosIniciales(); }
      }).catch(e => { showMain(); alert("Error al guardar: " + e.message); });
    } else {
      apiCall('guardarEvento', ev).then(r => {
        let res = r.result;
        if(res && res.error) { 
           alert(res.conflict ? res.error : "Error: " + res.error); 
           if(!res.conflict) showMain(); 
           else {
             document.getElementById('loader').classList.add('hidden');
             document.getElementById('form-view').classList.remove('hidden');
           }
        }
        else { if (queryActual) ejecutarBusqueda(); else cargarDatosIniciales(); }
      }).catch(e => { showMain(); alert("Error al guardar: " + e.message); });
    }
  }

  function borrarEvento(id) {
    if(!confirm("¿Estás seguro de eliminar esta actividad y todas sus subtareas?")) return;
    mostrarLoader("Eliminando...");
    apiCall('borrarEvento', id).then(r => { let res = r.result; if(res && res.error) { alert("Error: " + res.error); showMain(); } else { if(queryActual) ejecutarBusqueda(); else cargarDatosIniciales(); } }).catch(e => { showMain(); alert("Error al borrar: " + e.message); });
  }

  function showMain() {
    document.getElementById('form-view').classList.add('hidden');
    document.getElementById('detalle-view').classList.add('hidden');
    document.getElementById('main-view').classList.remove('hidden');
    if(activeTimerInterval) clearInterval(activeTimerInterval);
  }

  // DETALLES Y SUBTAREAS 
  
  function verDetalle(id) {
    currentEventoId = id;
    currentEventoData = eventosActuales.find(e => e.id === id);
    
    document.getElementById('det-titulo').innerText = currentEventoData.titulo;
    document.getElementById('det-badge').innerText = currentEventoData.tipo;
    document.getElementById('det-badge').className = 'badge'; 
    if(currentEventoData.tipo === 'Tarea') document.getElementById('det-badge').classList.add('badge-tarea');
    if(currentEventoData.tipo === 'Evento') document.getElementById('det-badge').classList.add('badge-evento');
    if(currentEventoData.tipo === 'Reunión') document.getElementById('det-badge').classList.add('badge-reunion');
    if(currentEventoData.tipo === 'GADPSDT') document.getElementById('det-badge').classList.add('badge-gadpsdt');
    
    document.getElementById('seccion-detalles-comunes').classList.add('hidden');
    document.getElementById('seccion-reunion').classList.add('hidden');
    document.getElementById('seccion-tarea').classList.add('hidden');
    
    if (currentEventoData.tipo === 'Reunión' || currentEventoData.tipo === 'Evento' || currentEventoData.tipo === 'GADPSDT') {
      document.getElementById('seccion-detalles-comunes').classList.remove('hidden');
      document.getElementById('det-asistentes').innerText = currentEventoData.asistentes || 'Ninguno';
      document.getElementById('det-acuerdos').innerText = currentEventoData.acuerdos || 'Ninguno';
      
      if(currentEventoData.ubicacion) {
        document.getElementById('det-ubicacion').innerHTML = `<a href="https://maps.google.com/?q=${encodeURIComponent(currentEventoData.ubicacion)}" target="_blank" style="color:#3498db; text-decoration:underline;">${currentEventoData.ubicacion}</a>`;
      } else {
        document.getElementById('det-ubicacion').innerText = 'No especificada';
      }
    }
    
    if (currentEventoData.tipo === 'Reunión' || currentEventoData.tipo === 'GADPSDT') {
      document.getElementById('seccion-reunion').classList.remove('hidden');
      cancelarEdicionSub();
      cargarSubtareas(id);
    } else if (currentEventoData.tipo === 'Tarea') {
      document.getElementById('seccion-tarea').classList.remove('hidden');
    }
    
    document.getElementById('main-view').classList.add('hidden');
    document.getElementById('detalle-view').classList.remove('hidden');
  }

  let subsActuales = [];
  
  function actualizarTiempoRestante() {
    if(!currentEventoData || (currentEventoData.tipo !== 'Reunión' && currentEventoData.tipo !== 'GADPSDT')) return;
    let tiempoMax = parseInt(currentEventoData.duracion) || 0;
    let tiempoUsado = subsActuales.reduce((acc, sub) => acc + (parseInt(sub.duracionAsignada) || 0), 0);
    let restante = tiempoMax - tiempoUsado;
    
    let el = document.getElementById('tiempo-restante');
    el.innerText = restante;
    if(restante < 0) {
       el.style.color = "red";
    } else {
       el.style.color = "inherit";
    }
    return restante;
  }

  function cargarSubtareas(id) {
    if(activeTimerInterval) clearInterval(activeTimerInterval);
    activeTimerId = null;
    // Use cache first for instant loading
    if (todasLasSubtareas.length > 0) {
      subsActuales = todasLasSubtareas.filter(s => s.idEvento === id || s.eventoId === id);
      document.getElementById('subtareas-list').innerHTML = '';
      actualizarTiempoRestante();
      renderSubtareas(subsActuales);
    } else {
      // Fallback: network call if cache not loaded yet
      apiCall('getSubtareasDeEvento', id).then(r => { 
        subsActuales = r.result || []; 
        actualizarTiempoRestante(); 
        renderSubtareas(subsActuales); 
      }).catch(err => {
        subsActuales = [];
        document.getElementById('subtareas-list').innerHTML = '<p style="color:red">Error cargando subtareas: ' + err.message + '</p>';
      });
    }
  }

  function renderSubtareas(subsToRender) {
    const div = document.getElementById('subtareas-list');
    div.innerHTML = '';
    if(subsToRender.length === 0) return div.innerHTML = '<p>No se encontraron subtareas con esos criterios.</p>';
    
    subsToRender.forEach(sub => {
      let cls = 'semaforo-rojo';
      if(sub.estado === 'Cumplido') cls = 'semaforo-verde';
      else if(sub.estado === 'En camino') cls = 'semaforo-amarillo';
      
      let refHtml = sub.referencia ? `<small style="color:#3498db; font-weight:bold; margin-right: 10px;">Ref: ${sub.referencia}</small>` : '';
      let duracionHtml = (sub.duracionAsignada > 0) ? `<small style="color:#8e44ad; font-weight:bold;">⏱️ ${sub.duracionAsignada} min</small>` : '';
      
      let colorTituloSub = sub.estado === 'Cumplido' ? '#27ae60' : (sub.estado === 'En camino' ? '#f39c12' : '#e74c3c');
      
      div.innerHTML += `
        <div class="subtarea-row">
          <div style="flex:1;">
             <div style="margin-bottom:5px;">
               <strong style="color:${colorTituloSub};">${sub.titulo}</strong> 
               <select id="select-estado-${sub.idSubtarea}" class="${cls}" style="border:none; outline:none; cursor:pointer; font-family:inherit; font-size:12px; margin-left:10px; font-weight:bold;" onchange="cambiarEstadoDesdeLista('${sub.idSubtarea}', this.value)">
                 <option value="En camino" style="color:black;" ${sub.estado === 'En camino' ? 'selected' : ''}>En camino</option>
                 <option value="Atrasado" style="color:black;" ${sub.estado === 'Atrasado' ? 'selected' : ''}>Atrasado</option>
                 <option value="Cumplido" style="color:black;" ${sub.estado === 'Cumplido' ? 'selected' : ''}>Cumplido</option>
               </select>
             </div>
             <div style="margin-bottom:5px;">
                <small style="color:#7f8c8d; margin-right: 10px;">Resp: ${sub.responsable} | Límite: ${sub.fechaLimiteUI}</small>
                ${refHtml}
                ${duracionHtml}
             </div>
          </div>
          <div style="display:flex; align-items:center;">
             <span class="timer-display hidden" id="timer-display-${sub.idSubtarea}">--:--</span>
             <button class="btn-icon" style="font-size:24px;" onclick="toggleTimer('${sub.idSubtarea}')" title="Iniciar/Pausar Cronómetro">▶️</button>
             <button class="btn-icon" onclick="editarSubtareaInit('${sub.idSubtarea}')" title="Editar">✏️</button>
             <button class="btn-icon" onclick="borrarSubtarea('${sub.idSubtarea}')" title="Borrar">🗑️</button>
          </div>
        </div>
        <div id="sub-form-slot-${sub.idSubtarea}"></div>`;
    });
    
    // Si había un timer activo y lo renderizamos, restablecer el UI (para cuando filtramos y vuelve a aparecer)
    if(activeTimerId) {
       let disp = document.getElementById('timer-display-' + activeTimerId);
       if(disp) disp.classList.remove('hidden');
    }
  }

  function filtrarSubtareasLocales() {
    let q = document.getElementById('sub-search-text').value.toLowerCase().trim();
    let est = document.getElementById('sub-search-estado').value;
    
    let filtradas = subsActuales.filter(sub => {
      let matchText = true;
      if (q !== "") {
         matchText = sub.titulo.toLowerCase().includes(q) || 
                     sub.responsable.toLowerCase().includes(q) ||
                     (sub.referencia && sub.referencia.toLowerCase().includes(q));
      }
      let matchStatus = (est === "Todos") || (sub.estado === est);
      return matchText && matchStatus;
    });
    renderSubtareas(filtradas);
  }

  // --- LOGICA DEL CRONÓMETRO ---
  function toggleTimer(idSub) {
    if (activeTimerId === idSub) {
       // Si es el mismo, pausarlo
       clearInterval(activeTimerInterval);
       activeTimerId = null;
       document.getElementById('timer-display-' + idSub).innerHTML += ' ⏸️';
       return;
    }
    
    // Si hay otro corriendo, pausarlo
    if (activeTimerId) {
       clearInterval(activeTimerInterval);
       let oldElem = document.getElementById('timer-display-' + activeTimerId);
       if(oldElem) oldElem.innerHTML += ' ⏸️';
    }

    const sub = subsActuales.find(s => s.idSubtarea === idSub);
    let duracionMinutos = parseInt(sub.duracionAsignada) || 0;
    if(duracionMinutos === 0) return alert("Esta tarea no tiene tiempo asignado.");

    activeTimerId = idSub;
    activeTimerTotalSeconds = duracionMinutos * 60;
    
    let display = document.getElementById('timer-display-' + idSub);
    display.classList.remove('hidden');
    let txt = display.innerText.replace(' ⏸️', '').trim();
    
    if (txt === '--:--') {
       activeTimerSecondsLeft = activeTimerTotalSeconds;
    } else {
       let parts = txt.split(':');
       if(parts.length === 2 && !isNaN(parts[0])) {
          activeTimerSecondsLeft = parseInt(parts[0])*60 + parseInt(parts[1]);
       } else {
          activeTimerSecondsLeft = activeTimerTotalSeconds;
       }
    }

    activeTimerInterval = setInterval(updateTimerUI, 1000);
    updateTimerUI(); // primer render
  }

  function updateTimerUI() {
    if(!activeTimerId) return;
    activeTimerSecondsLeft--;
    if(activeTimerSecondsLeft < 0) activeTimerSecondsLeft = 0;
    
    let m = Math.floor(activeTimerSecondsLeft / 60);
    let s = activeTimerSecondsLeft % 60;
    let str = (m < 10 ? '0'+m : m) + ':' + (s < 10 ? '0'+s : s);
    
    let display = document.getElementById('timer-display-' + activeTimerId);
    if(!display) return;
    
    display.innerText = str;
    display.className = 'timer-display'; // reset classes
    
    let pct = activeTimerSecondsLeft / activeTimerTotalSeconds;
    if(activeTimerSecondsLeft === 0) {
        display.classList.add('timer-red');
    } else if (pct <= 0.3) {
        display.classList.add('timer-orange');
    } else {
        display.classList.add('timer-green');
    }
  }

  function editarEventoInit(id) {
    openFormEvento(id);
  }

  function editarSubtareaInit(idSub) {
    editandoSubtareaId = idSub;
    const sub = subsActuales.find(s => s.idSubtarea === idSub);
    document.getElementById('sub-form-title').innerText = "✏️ Editar Subtarea";
    document.getElementById('sub-titulo').value = sub.titulo;
    document.getElementById('sub-fecha').value = sub.fechaLimite;
    
    document.getElementById('sub-resp').value = sub.responsable || "";
    if(sub.responsable) {
      responsablesArray = sub.responsable.split(',').map(s => s.trim()).filter(s => s !== "");
    } else {
      responsablesArray = [];
    }
    renderRespChips();
    document.getElementById('sub-resp-input').value = "";
    
    document.getElementById('sub-ref').value = sub.referencia || "";
    if(sub.referencia) {
      referenciasArray = sub.referencia.split(',').map(s => s.trim()).filter(s => s !== "");
    } else {
      referenciasArray = [];
    }
    renderRefChips();
    document.getElementById('sub-ref-input').value = "";
    
    document.getElementById('sub-estado').value = sub.estado;
    document.getElementById('sub-duracion').value = sub.duracionAsignada || 5;
    
    document.getElementById('sub-estado-container').classList.remove('hidden');
    document.getElementById('btn-save-sub').innerText = "Guardar Cambios";
    document.getElementById('btn-cancel-sub').classList.remove('hidden');
    
    // Move the form to the specific subtask slot
    let slot = document.getElementById('sub-form-slot-' + idSub);
    if(slot) {
      slot.appendChild(document.getElementById('panel-subtarea-form'));
    }
    
    // Check constraints bounds for scrolling
    setTimeout(() => {
      document.getElementById('panel-subtarea-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }

  function cancelarEdicionSub() {
    editandoSubtareaId = null;
    document.getElementById('sub-form-title').innerText = "+ Añadir Subtarea";
    document.getElementById('sub-titulo').value = '';
    document.getElementById('sub-fecha').value = '';
    
    document.getElementById('sub-resp').value = '';
    responsablesArray = [];
    renderRespChips();
    document.getElementById('sub-resp-input').value = "";
    
    document.getElementById('sub-ref').value = '';
    referenciasArray = [];
    renderRefChips();
    document.getElementById('sub-ref-input').value = "";
    
    document.getElementById('sub-duracion').value = 5;
    document.getElementById('sub-estado').value = 'En camino';
    
    document.getElementById('sub-estado-container').classList.add('hidden');
    document.getElementById('btn-save-sub').innerText = "Añadir Subtarea";
    document.getElementById('btn-cancel-sub').classList.add('hidden');
    
    // Return form to its original container
    let originalContainer = document.getElementById('subtareas-form-container-original');
    if(originalContainer) {
      originalContainer.appendChild(document.getElementById('panel-subtarea-form'));
    }
  }

  function guardarSubtareaBtn() {
    // FORCE FLUSH PENDING RESPONSABLES INPUT
    const respInputVal = document.getElementById('sub-resp-input').value.trim().replace(',', '');
    if (respInputVal && !responsablesArray.includes(respInputVal)) {
      responsablesArray.push(respInputVal);
      document.getElementById('sub-resp').value = responsablesArray.join(', ');
      document.getElementById('sub-resp-input').value = '';
    }

    // FORCE FLUSH PENDING REFERENCIA INPUT
    const refInputVal = document.getElementById('sub-ref-input').value.trim().replace(',', '');
    if (refInputVal && !referenciasArray.includes(refInputVal)) {
      referenciasArray.push(refInputVal);
      document.getElementById('sub-ref').value = referenciasArray.join(', ');
      document.getElementById('sub-ref-input').value = '';
    }

    const sub = {
      titulo: document.getElementById('sub-titulo').value,
      fechaLimite: document.getElementById('sub-fecha').value,
      responsable: document.getElementById('sub-resp').value,
      referencia: document.getElementById('sub-ref').value,
      estado: document.getElementById('sub-estado').value,
      duracionAsignada: parseInt(document.getElementById('sub-duracion').value) || 0
    };
    if(!sub.titulo || !sub.fechaLimite) return alert("Faltan datos de la subtarea.");
    
    // Validación de Tiempo
    let restanteActual = actualizarTiempoRestante(); // Recalcula el restante total
    if (editandoSubtareaId) {
       // Sumar el tiempo de la tarea actual antes de la edición para ver cuánto hay disponible realmente
       let subVieja = subsActuales.find(s => s.idSubtarea === editandoSubtareaId);
       restanteActual += (parseInt(subVieja.duracionAsignada) || 0);
    }
    
    if (sub.duracionAsignada > restanteActual) {
       return alert(`¡Cuidado! Estás asignando ${sub.duracionAsignada} minutos, pero a la reunión solo le quedan ${restanteActual} minutos disponibles.`);
    }

    // Mover el panel a su contenedor original ANTES de sobreescribir subtareas-list
    let originalContainer = document.getElementById('subtareas-form-container-original');
    let panel = document.getElementById('panel-subtarea-form');
    if (originalContainer && panel) {
      originalContainer.appendChild(panel);
    }

    document.getElementById('subtareas-list').innerHTML = '<i>Guardando...</i>';
    if(editandoSubtareaId) {
      sub.idSubtarea = editandoSubtareaId;
      apiCall('editarSubtarea', sub)
        .then(r => { let res = r.result; if(res && res.error) alert("Error: " + res.error); todasLasSubtareas = []; cancelarEdicionSub(); cargarSubtareas(currentEventoId); })
        .catch(e => { alert("Error al guardar subtarea: " + e.message); document.getElementById('subtareas-list').innerHTML = '<p style="color:red">Error: ' + e.message + '</p>'; cancelarEdicionSub(); });
    } else {
      sub.idEvento = currentEventoId;
      apiCall('guardarSubtarea', sub)
        .then(r => { let res = r.result; if(res && res.error) alert("Error: " + res.error); todasLasSubtareas = []; cancelarEdicionSub(); cargarSubtareas(currentEventoId); })
        .catch(e => { alert("Error al guardar subtarea: " + e.message); document.getElementById('subtareas-list').innerHTML = '<p style="color:red">Error: ' + e.message + '</p>'; cancelarEdicionSub(); });
    }
  }

  function borrarSubtarea(idSub) {
    if(!confirm("¿Borrar esta subtarea permanentemente?")) return;
    document.getElementById('subtareas-list').innerHTML = '<i>Borrando...</i>';
    apiCall('borrarSubtarea', idSub).then(r => { let res = r.result; if(res && res.error) alert("Error: " + res.error); todasLasSubtareas = []; cargarSubtareas(currentEventoId); }).catch(e => { alert("Error: " + e.message); cargarSubtareas(currentEventoId); });
  }

  function cambiarEstadoDesdeLista(idSub, nuevoEstado) {
    const sub = subsActuales.find(s => s.idSubtarea === idSub);
    if (!sub || sub.estado === nuevoEstado) return;
    
    const oldEstado = sub.estado;
    sub.estado = nuevoEstado;
    
    // UI Optimista
    const selectElem = document.getElementById('select-estado-' + idSub);
    if(selectElem) {
        selectElem.className = '';
        if(nuevoEstado === 'Cumplido') selectElem.classList.add('semaforo-verde');
        else if(nuevoEstado === 'En camino') selectElem.classList.add('semaforo-amarillo');
        else selectElem.classList.add('semaforo-rojo');
    }
    
    apiCall('editarSubtarea', sub).then(r => { let res = r.result; if(res && res.error) { alert("Error actualizando estado: " + res.error); sub.estado = oldEstado; cargarSubtareas(currentEventoId); } });
  }

  function descargarPDF() {
    alert("Generando PDF de la reunión... puede tardar unos 10 segundos.");
    apiCall('generarPDF', currentEventoId).then(r => { 
      let res = r.result; 
      if (res.success && res.base64) {
        const link = document.createElement('a');
        link.href = 'data:application/pdf;base64,' + res.base64;
        link.download = res.filename || 'Reporte.pdf';
        link.click();
      } else {
        alert("Error: " + res.error);
      }
    }).catch(e => alert("Error al generar PDF: " + e.message));
  }

  function obtenerUbicacionActual() {
    if (navigator.geolocation) {
      document.getElementById('ubicacion').value = "Obteniendo ubicación...";
      navigator.geolocation.getCurrentPosition(function(position) {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        document.getElementById('ubicacion').value = lat + "," + lon;
      }, function(error) {
        alert("Error al obtener ubicación: Asegúrate de darle permisos al navegador. Detalles: " + error.message);
        document.getElementById('ubicacion').value = "";
      });
    } else {
      alert("La geolocalización no es soportada por este navegador.");
    }
  }


document.addEventListener("DOMContentLoaded", cargarDatosIniciales);
