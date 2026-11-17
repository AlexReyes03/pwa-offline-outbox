'use strict';

importScripts('./db-helper.js');

var CACHE_NAME = 'static-outbox-v2';
var API_URL = 'https://jsonplaceholder.typicode.com/posts';
var SYNC_TAG = 'sync-reportes';

var APP_SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './db-helper.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(function (cache) {
        return cache.addAll(APP_SHELL_ASSETS);
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (cacheNames) {
        var obsoletos = cacheNames.filter(function (name) {
          return name !== CACHE_NAME;
        });
        return Promise.all(
          obsoletos.map(function (name) {
            return caches.delete(name);
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') {
    return;
  }

  var requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function (cachedResponse) {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).catch(function () {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Recurso no disponible sin conexión.', {
          status: 503,
          statusText: 'Service Unavailable'
        });
      });
    })
  );
});

/**
 * Envía una notificación por postMessage a todas las ventanas abiertas de la PWA.
 * @returns {Promise<void>}
 */
function notificarClientesActualizacion() {
  return self.clients
    .matchAll({
      type: 'window',
      includeUncontrolled: true
    })
    .then(function (clients) {
      var payload = {
        tipo: 'OUTBOX_SINCRONIZADO',
        timestamp: Date.now()
      };
      clients.forEach(function (client) {
        client.postMessage(payload);
      });
    });
}

/**
 * Lee registros pendientes en IndexedDB, los reenvía al endpoint y actualiza su estado.
 * @returns {Promise<void>}
 */
function sincronizarPendientesSW() {
  return obtenerTodosLosRegistros().then(function (registros) {
    var pendientes = registros.filter(function (reg) {
      return reg.estado === 'pendiente';
    });

    if (pendientes.length === 0) {
      return Promise.resolve();
    }

    var promesas = pendientes.map(function (reg) {
      return fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8'
        },
        body: JSON.stringify({
          title: reg.titulo,
          body: reg.descripcion,
          userId: 1
        })
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error('Error HTTP ' + response.status + ' en Background Sync');
          }
          return response.json();
        })
        .then(function () {
          return actualizarEstadoRegistro(reg.id, 'sincronizado');
        });
    });

    return Promise.all(promesas).then(function () {
      return notificarClientesActualizacion();
    });
  });
}

self.addEventListener('sync', function (event) {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(
      sincronizarPendientesSW().catch(function (error) {
        console.error('[SW] Falla al sincronizar pendientes:', error);
        throw error;
      })
    );
  }
});
