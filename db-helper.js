'use strict';

var DB_NAME = 'pwa-outbox-db';
var DB_VERSION = 1;
var STORE_NAME = 'transacciones_pendientes';

/**
 * Abre la base de datos IndexedDB y crea el object store en onupgradeneeded si no existe.
 * @returns {Promise<IDBDatabase>}
 */
function abrirDB() {
  return new Promise(function (resolve, reject) {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no está disponible en este entorno.'));
      return;
    }

    var request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = function (event) {
      var db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true
        });
      }
    };

    request.onsuccess = function (event) {
      resolve(event.target.result);
    };

    request.onerror = function (event) {
      reject(event.target.error || new Error('Error al abrir IndexedDB.'));
    };

    request.onblocked = function () {
      reject(new Error('Apertura de IndexedDB bloqueada por otra conexión activa.'));
    };
  });
}

/**
 * Inserta un nuevo registro en el object store y resuelve cuando la transacción se completa en disco.
 * @param {Object} datos
 * @returns {Promise<number>} ID autogenerado del registro guardado.
 */
function guardarRegistro(datos) {
  return abrirDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var idGenerado;
      var settled = false;
      var tx = db.transaction(STORE_NAME, 'readwrite');
      var store = tx.objectStore(STORE_NAME);
      var request = store.add(datos);

      request.onsuccess = function (event) {
        idGenerado = event.target.result;
      };

      request.onerror = function (event) {
        if (!settled) {
          settled = true;
          reject(event.target.error || new Error('Error al agregar registro.'));
        }
      };

      tx.oncomplete = function () {
        db.close();
        if (!settled) {
          settled = true;
          resolve(idGenerado);
        }
      };

      tx.onerror = function (event) {
        db.close();
        if (!settled) {
          settled = true;
          reject(event.target.error || new Error('Error en la transacción de escritura.'));
        }
      };

      tx.onabort = function (event) {
        db.close();
        if (!settled) {
          settled = true;
          reject(event.target.error || new Error('Transacción de escritura abortada.'));
        }
      };
    });
  });
}

/**
 * Obtiene todos los registros almacenados en el object store.
 * @returns {Promise<Array<Object>>}
 */
function obtenerTodosLosRegistros() {
  return abrirDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var resultados = [];
      var settled = false;
      var tx = db.transaction(STORE_NAME, 'readonly');
      var store = tx.objectStore(STORE_NAME);
      var request = store.getAll();

      request.onsuccess = function (event) {
        resultados = event.target.result || [];
      };

      request.onerror = function (event) {
        if (!settled) {
          settled = true;
          reject(event.target.error || new Error('Error al leer registros.'));
        }
      };

      tx.oncomplete = function () {
        db.close();
        if (!settled) {
          settled = true;
          resolve(resultados);
        }
      };

      tx.onerror = function (event) {
        db.close();
        if (!settled) {
          settled = true;
          reject(event.target.error || new Error('Error en la transacción de lectura.'));
        }
      };

      tx.onabort = function (event) {
        db.close();
        if (!settled) {
          settled = true;
          reject(event.target.error || new Error('Transacción de lectura abortada.'));
        }
      };
    });
  });
}

/**
 * Elimina un registro por su llave primaria.
 * @param {number} id
 * @returns {Promise<void>}
 */
function eliminarRegistro(id) {
  return abrirDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var tx = db.transaction(STORE_NAME, 'readwrite');
      var store = tx.objectStore(STORE_NAME);
      var request = store.delete(id);

      request.onerror = function (event) {
        if (!settled) {
          settled = true;
          reject(event.target.error || new Error('Error al eliminar registro.'));
        }
      };

      tx.oncomplete = function () {
        db.close();
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      tx.onerror = function (event) {
        db.close();
        if (!settled) {
          settled = true;
          reject(event.target.error || new Error('Error en la transacción de eliminación.'));
        }
      };

      tx.onabort = function (event) {
        db.close();
        if (!settled) {
          settled = true;
          reject(event.target.error || new Error('Transacción de eliminación abortada.'));
        }
      };
    });
  });
}

/**
 * Actualiza el estado (y fechaSincronizacion si corresponde) de un registro existente en una sola transacción.
 * @param {number} id
 * @param {'pendiente'|'sincronizado'} nuevoEstado
 * @returns {Promise<Object>}
 */
function actualizarEstadoRegistro(id, nuevoEstado) {
  return abrirDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var registroActualizado = null;
      var tx = db.transaction(STORE_NAME, 'readwrite');
      var store = tx.objectStore(STORE_NAME);
      var getRequest = store.get(id);

      getRequest.onsuccess = function (event) {
        var registro = event.target.result;
        if (!registro) {
          settled = true;
          reject(new Error('No se encontró el registro con id: ' + id));
          tx.abort();
          return;
        }

        registro.estado = nuevoEstado;
        if (nuevoEstado === 'sincronizado') {
          registro.fechaSincronizacion = Date.now();
        }
        registroActualizado = registro;

        var putRequest = store.put(registro);
        putRequest.onerror = function (putEvent) {
          if (!settled) {
            settled = true;
            reject(putEvent.target.error || new Error('Error al actualizar registro.'));
          }
        };
      };

      getRequest.onerror = function (event) {
        if (!settled) {
          settled = true;
          reject(event.target.error || new Error('Error al buscar registro para actualizar.'));
        }
      };

      tx.oncomplete = function () {
        db.close();
        if (!settled) {
          settled = true;
          resolve(registroActualizado);
        }
      };

      tx.onerror = function (event) {
        db.close();
        if (!settled) {
          settled = true;
          reject(event.target.error || new Error('Error en la transacción de actualización.'));
        }
      };

      tx.onabort = function (event) {
        db.close();
        if (!settled) {
          settled = true;
          reject(event.target.error || new Error('Transacción de actualización abortada.'));
        }
      };
    });
  });
}
