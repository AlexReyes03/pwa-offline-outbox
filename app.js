'use strict';

var API_URL = 'https://jsonplaceholder.typicode.com/posts';
var SYNC_TAG = 'sync-reportes';

/**
 * Envía una incidencia por POST al endpoint configurado.
 * @param {{ titulo: string, descripcion: string }} datos
 * @returns {Promise<Object>}
 */
function enviarIncidenciaAPI(datos) {
  return fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8'
    },
    body: JSON.stringify({
      title: datos.titulo,
      body: datos.descripcion,
      userId: 1
    })
  }).then(function (response) {
    if (!response.ok) {
      throw new Error('Respuesta HTTP no exitosa: ' + response.status);
    }
    return response.json();
  });
}

/**
 * Actualiza el indicador visual del estado de conectividad en el encabezado.
 */
function actualizarIndicadorRed() {
  var badge = document.getElementById('badge-red');
  if (!badge) {
    return;
  }

  if (navigator.onLine) {
    badge.textContent = 'En línea';
    badge.className = 'badge badge--online';
  } else {
    badge.textContent = 'Sin conexión';
    badge.className = 'badge badge--offline';
  }
}

/**
 * Muestra un mensaje breve de retroalimentación debajo del formulario.
 * @param {string} mensaje
 */
function mostrarFeedback(mensaje) {
  var feedback = document.getElementById('estado-envio');
  if (feedback) {
    feedback.textContent = mensaje;
  }
}

/**
 * Formatea una marca de tiempo epoch en fecha y hora legible local.
 * @param {number|null|undefined} timestamp
 * @returns {string}
 */
function formatearHora(timestamp) {
  if (!timestamp) {
    return '';
  }
  return new Date(timestamp).toLocaleString('es-MX', {
    dateStyle: 'short',
    timeStyle: 'medium'
  });
}

/**
 * Registra la etiqueta de Background Sync si el navegador soporta SyncManager.
 * @returns {Promise<void>}
 */
function registrarBackgroundSync() {
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) {
    return Promise.resolve();
  }

  return navigator.serviceWorker.ready
    .then(function (registration) {
      return registration.sync.register(SYNC_TAG);
    })
    .catch(function (error) {
      console.warn('No se pudo registrar Background Sync:', error);
    });
}

/**
 * Intenta enviar la incidencia al servidor; si falla, la encola como pendiente en IndexedDB.
 * @param {{ titulo: string, descripcion: string }} datosFormulario
 * @returns {Promise<void>}
 */
function procesarEnvioReporte(datosFormulario) {
  var ahora = Date.now();

  return enviarIncidenciaAPI(datosFormulario)
    .then(
      function () {
        return guardarRegistro({
          titulo: datosFormulario.titulo,
          descripcion: datosFormulario.descripcion,
          estado: 'sincronizado',
          fechaCreacion: ahora,
          fechaSincronizacion: Date.now()
        })
          .then(function () {
            mostrarFeedback('Incidencia enviada y registrada como sincronizada.');
          })
          .catch(function (errorLocal) {
            console.error('El envío al servidor fue exitoso, pero falló el guardado local en IndexedDB:', errorLocal);
            mostrarFeedback('Incidencia enviada al servidor, pero ocurrió un error al guardarla localmente.');
          });
      },
      function (errorEnvio) {
        console.warn('Envío fallido, guardando incidencia en outbox local:', errorEnvio);
        return guardarRegistro({
          titulo: datosFormulario.titulo,
          descripcion: datosFormulario.descripcion,
          estado: 'pendiente',
          fechaCreacion: ahora,
          fechaSincronizacion: null
        })
          .then(function () {
            return registrarBackgroundSync();
          })
          .then(function () {
            mostrarFeedback('Sin conexión o falla de red: incidencia encolada como pendiente.');
          });
      }
    )
    .then(function () {
      return renderizarColaOutbox();
    })
    .catch(function (error) {
      console.error('Error al procesar el reporte:', error);
      mostrarFeedback('Ocurrió un error al guardar la incidencia.');
    });
}

/**
 * Lee todos los registros de IndexedDB y renderiza la lista Outbox usando APIs seguras del DOM.
 * @returns {Promise<void>}
 */
function renderizarColaOutbox() {
  var lista = document.getElementById('lista-outbox');
  if (!lista) {
    return Promise.resolve();
  }

  return obtenerTodosLosRegistros()
    .then(function (registros) {
      lista.replaceChildren();

      if (!registros || registros.length === 0) {
        var emptyItem = document.createElement('li');
        emptyItem.className = 'outbox-empty';
        emptyItem.textContent = 'No hay incidencias en la bandeja.';
        lista.appendChild(emptyItem);
        return;
      }

      var ordenados = registros.slice().sort(function (a, b) {
        return (b.fechaCreacion || 0) - (a.fechaCreacion || 0);
      });

      ordenados.forEach(function (registro) {
        var item = document.createElement('li');
        item.className = 'outbox-item';

        var top = document.createElement('div');
        top.className = 'outbox-item-top';

        var tituloEl = document.createElement('h3');
        tituloEl.className = 'outbox-title';
        tituloEl.textContent = registro.titulo || 'Sin título';

        var estado = registro.estado === 'sincronizado' ? 'sincronizado' : 'pendiente';
        var pill = document.createElement('span');
        pill.className = 'status-pill status-pill--' + estado;
        pill.textContent = estado;

        top.appendChild(tituloEl);
        top.appendChild(pill);

        var descEl = document.createElement('p');
        descEl.className = 'outbox-desc';
        descEl.textContent = registro.descripcion || '';

        var meta = document.createElement('div');
        meta.className = 'outbox-meta';

        var creadaEl = document.createElement('span');
        creadaEl.textContent = 'Creada: ' + formatearHora(registro.fechaCreacion);
        meta.appendChild(creadaEl);

        if (registro.fechaSincronizacion) {
          var syncEl = document.createElement('span');
          syncEl.textContent = 'Sincronizada: ' + formatearHora(registro.fechaSincronizacion);
          meta.appendChild(syncEl);
        }

        item.appendChild(top);
        if (registro.descripcion) {
          item.appendChild(descEl);
        }
        item.appendChild(meta);
        lista.appendChild(item);
      });
    })
    .catch(function (error) {
      console.error('Error al renderizar la cola outbox:', error);
    });
}

/**
 * Fallback de sincronización en el hilo principal para navegadores sin soporte de SyncManager.
 * @returns {Promise<void>}
 */
function sincronizarPendientesFallback() {
  return obtenerTodosLosRegistros()
    .then(function (registros) {
      var pendientes = registros.filter(function (reg) {
        return reg.estado === 'pendiente';
      });

      if (pendientes.length === 0) {
        return Promise.resolve();
      }

      var promesas = pendientes.map(function (reg) {
        return enviarIncidenciaAPI({
          titulo: reg.titulo,
          descripcion: reg.descripcion
        }).then(function () {
          return actualizarEstadoRegistro(reg.id, 'sincronizado');
        });
      });

      return Promise.all(promesas);
    })
    .then(function () {
      return renderizarColaOutbox();
    })
    .catch(function (error) {
      console.error('Error durante sincronizarPendientesFallback:', error);
      return renderizarColaOutbox();
    });
}

/**
 * Elimina únicamente los registros con estado sincronizado de IndexedDB.
 * @returns {Promise<void>}
 */
function purgarSincronizados() {
  return obtenerTodosLosRegistros()
    .then(function (registros) {
      var sincronizados = registros.filter(function (reg) {
        return reg.estado === 'sincronizado';
      });

      if (sincronizados.length === 0) {
        mostrarFeedback('No hay registros sincronizados para purgar.');
        return Promise.resolve();
      }

      var promesas = sincronizados.map(function (reg) {
        return eliminarRegistro(reg.id);
      });

      return Promise.all(promesas).then(function () {
        mostrarFeedback('Registros sincronizados eliminados.');
      });
    })
    .then(function () {
      return renderizarColaOutbox();
    })
    .catch(function (error) {
      console.error('Error al purgar registros sincronizados:', error);
      mostrarFeedback('No se pudieron purgar los registros sincronizados.');
    });
}

/**
 * Registra el Service Worker usando ruta relativa para compatibilidad con subdirectorios.
 */
function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  navigator.serviceWorker
    .register('./sw.js')
    .then(function (registration) {
      console.info('Service Worker registrado con scope:', registration.scope);
    })
    .catch(function (error) {
      console.error('Error al registrar el Service Worker:', error);
    });
}

document.addEventListener('DOMContentLoaded', function () {
  actualizarIndicadorRed();
  renderizarColaOutbox();
  registrarServiceWorker();

  var form = document.getElementById('form-incidencia');
  if (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var inputTitulo = document.getElementById('titulo');
      var inputDescripcion = document.getElementById('descripcion');
      var titulo = inputTitulo ? inputTitulo.value.trim() : '';
      var descripcion = inputDescripcion ? inputDescripcion.value.trim() : '';

      if (!titulo || !descripcion) {
        mostrarFeedback('Completa el título y la descripción antes de enviar.');
        return;
      }

      procesarEnvioReporte({
        titulo: titulo,
        descripcion: descripcion
      });
      form.reset();
    });
  }

  var btnPurgar = document.getElementById('btn-purgar');
  if (btnPurgar) {
    btnPurgar.addEventListener('click', function () {
      purgarSincronizados();
    });
  }
});

window.addEventListener('online', function () {
  actualizarIndicadorRed();
  if (!('SyncManager' in window) || !('serviceWorker' in navigator)) {
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', function () {
  actualizarIndicadorRed();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', function (event) {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      renderizarColaOutbox();
    }
  });
}
