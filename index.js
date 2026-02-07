// ==UserScript==
// @name         PlexDL Tampermonkey
// @version      2.11.1
// @description  Descarga series, temporadas o capítulos desde Plex con modals y explora bibliotecas en PlexDL. Estilos ajustados al botón premium.
// @author       FSociety
// @match        *://*.plex.tv/*
// @match        *://*.plex.direct/*
// @grant        GM_download
// @grant        GM_addStyle
// ==/UserScript==


(function() {
    'use strict';

    // Expresiones regulares globales
    const clientIdRegex = /server\/([a-f0-9]{40})\//;
    const metadataIdRegex = /key=%2Flibrary%2Fmetadata%2F(\d+)/;

    // --- CSS para los botones ---
    GM_addStyle(`
        #plex-download-button {
            cursor: pointer;
            display: flex;
            gap: 8px;
            background-color: #e5a00d;
            color: #1e1e27;
            border: none;
            border-radius: 4px;
            padding: 8px 16px;
            font-weight: bold;
            align-items: center;
            transition: background-color 0.2s, transform 0.1s;
        }
        #plex-download-button:hover {
            background-color: #e0b316;
            transform: translateY(-1px);
        }
        #plex-download-button > svg {
            height: 24px;
        }
        #plexdl-browse-button {
            cursor: pointer;
            display: inline-flex;
            gap: 8px;
            align-items: center;
            transition: background-color 0.2s, transform 0.1s;
            background-color: #e5a00d;
            color: #000000;
            font-weight: 700;
            border: none;
            border-radius: 4px;
            padding: 4px 16px;
            height: 28px;
            min-height: 28px;
        }
        #plexdl-browse-button:hover {
            transform: translateY(-1px);
            opacity: 0.9;
        }

        /* Dropdown selector de servidores */
        #plexdl-server-selector {
            position: relative;
            display: inline-flex;
            align-items: center;
            margin-left: 12px;
            margin-right: 12px;
        }
        #plexdl-server-dropdown {
            cursor: pointer;
            display: inline-flex;
            gap: 8px;
            align-items: center;
            padding: 4px 16px;
            border-radius: 4px;
            font-weight: 600;
            background-color: #1f2937;
            color: white;
            border: 1px solid #374151;
            transition: all 0.2s;
            font-size: 14px;
            height: 28px;
            min-height: 28px;
        }
        #plexdl-server-dropdown:hover {
            background-color: #374151;
            border-color: #4b5563;
        }
        #plexdl-server-menu {
            position: absolute;
            top: calc(100% + 8px);
            left: 0;
            background: #1e1e27;
            border: 1px solid #374151;
            border-radius: 8px;
            min-width: 250px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            z-index: 999999;
            display: none;
            max-height: 400px;
            overflow-y: auto;
        }
        #plexdl-server-menu.show {
            display: block;
            animation: slideDown 0.2s ease-out;
        }
        @keyframes slideDown {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        #plexdl-server-menu .menu-item {
            padding: 12px 16px;
            cursor: pointer;
            transition: background 0.15s;
            display: flex;
            align-items: center;
            gap: 12px;
            border-bottom: 1px solid #374151;
        }
        #plexdl-server-menu .menu-item:last-child {
            border-bottom: none;
        }
        #plexdl-server-menu .menu-item:hover {
            background: #374151;
        }
        #plexdl-server-menu .menu-item.active {
            background: #2563eb;
        }
        #plexdl-server-menu .menu-item .server-icon-small {
            font-size: 18px;
        }
        #plexdl-server-menu .menu-item .server-details {
            flex: 1;
        }
        #plexdl-server-menu .menu-item .server-name-small {
            color: #f3f4f6;
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 2px;
        }
        #plexdl-server-menu .menu-item .server-status-small {
            color: #9ca3af;
            font-size: 12px;
        }
        #plexdl-server-menu .menu-item.active .server-name-small,
        #plexdl-server-menu .menu-item.active .server-status-small {
            color: white;
        }
        #plexdl-server-menu .menu-header {
            padding: 12px 16px;
            background: #282833;
            border-bottom: 1px solid #374151;
            color: #e5a00d;
            font-weight: 700;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        /* Modal selector de servidores (mantener por compatibilidad) */
        #plexdl-server-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 999999;
            animation: fadeIn 0.2s ease-out;
        }
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        #plexdl-server-modal .modal-content {
            background: #1e1e27;
            border-radius: 12px;
            padding: 32px;
            max-width: 500px;
            width: 90%;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            animation: slideUp 0.3s ease-out;
        }
        @keyframes slideUp {
            from { transform: translateY(30px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        #plexdl-server-modal h2 {
            color: #e5a00d;
            font-size: 24px;
            margin-bottom: 8px;
            font-weight: 700;
        }
        #plexdl-server-modal p {
            color: #9ca3af;
            margin-bottom: 24px;
            font-size: 14px;
        }
        #plexdl-server-modal .server-item {
            background: #282833;
            border: 2px solid transparent;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 12px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        #plexdl-server-modal .server-item:hover {
            border-color: #e5a00d;
            background: #32323d;
            transform: translateX(4px);
        }
        #plexdl-server-modal .server-item.selected {
            border-color: #e5a00d;
            background: #32323d;
        }
        #plexdl-server-modal .server-icon {
            width: 40px;
            height: 40px;
            background: linear-gradient(135deg, #e5a00d 0%, #f5b81d 100%);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            flex-shrink: 0;
        }
        #plexdl-server-modal .server-info {
            flex: 1;
        }
        #plexdl-server-modal .server-name {
            color: #f3f4f6;
            font-weight: 600;
            font-size: 16px;
            margin-bottom: 4px;
        }
        #plexdl-server-modal .server-status {
            color: #9ca3af;
            font-size: 13px;
        }
        #plexdl-server-modal .server-status.online {
            color: #10b981;
        }
        #plexdl-server-modal .button-group {
            display: flex;
            gap: 12px;
            margin-top: 24px;
        }
        #plexdl-server-modal button {
            flex: 1;
            padding: 12px 24px;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            border: none;
            font-size: 14px;
        }
        #plexdl-server-modal .btn-primary {
            background: linear-gradient(135deg, #e5a00d 0%, #f5b81d 100%);
            color: #000;
        }
        #plexdl-server-modal .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 16px rgba(229, 160, 13, 0.4);
        }
        #plexdl-server-modal .btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        #plexdl-server-modal .btn-secondary {
            background: #374151;
            color: #f3f4f6;
        }
        #plexdl-server-modal .btn-secondary:hover {
            background: #4b5563;
        }

        /* Responsive para dispositivos móviles */
        @media (max-width: 1024px) {
            #plexdl-browse-button span:last-child {
                display: none;
            }
            #plexdl-browse-button {
                padding: 4px 12px;
                min-width: 40px;
            }
            #plexdl-server-dropdown {
                padding: 4px 12px;
                font-size: 13px;
            }
            #plexdl-server-dropdown > span:nth-child(2) {
                max-width: 100px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
        }

        @media (max-width: 768px) {
            #plexdl-server-selector {
                margin-left: 8px;
                margin-right: 8px;
            }
            #plexdl-browse-button {
                padding: 4px 10px;
            }
            #plexdl-server-dropdown {
                padding: 4px 10px;
                font-size: 12px;
            }
            #plexdl-server-dropdown > span:nth-child(2) {
                max-width: 80px;
            }
        }

        @media (max-width: 480px) {
            #plexdl-server-selector {
                margin-left: 4px;
                margin-right: 4px;
            }
            #plexdl-browse-button {
                padding: 4px 8px;
            }
            #plexdl-server-dropdown {
                padding: 4px 8px;
                gap: 4px;
            }
            #plexdl-server-dropdown > span:nth-child(2) {
                max-width: 60px;
            }
            #plexdl-server-dropdown > span:last-child {
                display: none;
            }
        }
    `);

    // --- Utilidades ---
    function getToken() {
        return localStorage.getItem('myPlexAccessToken') || localStorage.getItem('X-Plex-Token');
    }

    // Devuelve el baseUri realmente funcional (protocolo comprobado) para usar en todos los enlaces
    let lastWorkingBaseUri = null;
    function getXml(url, callback, onBaseUriChecked) {
        // Intenta con el protocolo original, si falla por Mixed Content o error, prueba el alternativo (http <-> https)
        function tryRequest(testUrl, fallbackUrl, originalBaseUri) {
            const xhr = new XMLHttpRequest();
            xhr.onreadystatechange = function() {
                if (xhr.readyState === 4) {
                    if (xhr.status === 200) {
                        // Guardar el baseUri funcional si se solicita
                        if (onBaseUriChecked) {
                            const workingBaseUri = testUrl.split('/library/')[0];
                            lastWorkingBaseUri = workingBaseUri;
                            onBaseUriChecked(workingBaseUri);
                        }
                        callback(xhr.responseXML);
                    } else if (fallbackUrl) {
                        tryRequest(fallbackUrl, null, originalBaseUri);
                    } else {
                        alert('No se pudo conectar al servidor Plex (Mixed Content o inaccesible).');
                    }
                }
            };
            try {
                xhr.open('GET', testUrl);
                xhr.send();
            } catch (e) {
                if (fallbackUrl) {
                    tryRequest(fallbackUrl, null, originalBaseUri);
                } else {
                    alert('No se pudo conectar al servidor Plex (Mixed Content o inaccesible).');
                }
            }
        }
        // Detectar protocolo y preparar fallback
        let fallbackUrl = null;
        if (url.startsWith('http://')) {
            fallbackUrl = url.replace('http://', 'https://');
        } else if (url.startsWith('https://')) {
            fallbackUrl = url.replace('https://', 'http://');
        }
        tryRequest(url, fallbackUrl, url.split('/library/')[0]);
    }

    // --- Guardar y recuperar tmdbId del localStorage ---
    function saveTmdbId(ratingKey, tmdbId) {
        if (!ratingKey || !tmdbId) return;
        const storageKey = `plexdl_tmdb_${ratingKey}`;
        localStorage.setItem(storageKey, tmdbId);
        console.log(`PlexDL: TMDB ID guardado - ratingKey: ${ratingKey}, tmdbId: ${tmdbId}`);
    }

    function getTmdbId(ratingKey) {
        if (!ratingKey) return '';
        const storageKey = `plexdl_tmdb_${ratingKey}`;
        const tmdbId = localStorage.getItem(storageKey) || '';
        console.log(`PlexDL: TMDB ID recuperado - ratingKey: ${ratingKey}, tmdbId: ${tmdbId}`);
        return tmdbId;
    }

    // --- Guardar y recuperar servidor preferido ---
    function savePreferredServer(clientId) {
        localStorage.setItem('plexdl_preferred_server', clientId);
        console.log('PlexDL: Servidor preferido guardado:', clientId);
    }

    function getPreferredServer() {
        return localStorage.getItem('plexdl_preferred_server') || '';
    }

    function clearPreferredServer() {
        localStorage.removeItem('plexdl_preferred_server');
        console.log('PlexDL: Servidor preferido borrado');
    }

    // --- Obtener lista de servidores disponibles ---
    function getAvailableServers(resourcesXml) {
        const servers = [];
        const devices = resourcesXml.getElementsByTagName('Device');

        for (let i = 0; i < devices.length; i++) {
            const device = devices[i];
            const provides = device.getAttribute('provides');

            // Solo incluir dispositivos que proveen servidor
            if (provides && provides.includes('server')) {
                const name = device.getAttribute('name') || 'Servidor sin nombre';
                const clientId = device.getAttribute('clientIdentifier');
                const accessToken = device.getAttribute('accessToken');
                const connections = device.getElementsByTagName('Connection');

                // Buscar conexión remota preferiblemente
                let uri = null;
                let isLocal = false;

                for (let j = 0; j < connections.length; j++) {
                    const conn = connections[j];
                    const local = conn.getAttribute('local');
                    const connUri = conn.getAttribute('uri');

                    if (local === '0' && connUri) {
                        uri = connUri;
                        isLocal = false;
                        break;
                    } else if (connUri && !uri) {
                        uri = connUri;
                        isLocal = true;
                    }
                }

                if (clientId && accessToken && uri) {
                    servers.push({
                        name: name,
                        clientId: clientId,
                        accessToken: accessToken,
                        baseUri: uri,
                        isLocal: isLocal
                    });
                }
            }
        }

        return servers;
    }

    // --- Mostrar modal de selección de servidor ---
    function showServerSelector(servers, callback) {
        // Eliminar modal previo si existe
        const existingModal = document.getElementById('plexdl-server-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Crear modal
        const modal = document.createElement('div');
        modal.id = 'plexdl-server-modal';

        let selectedServer = null;

        const serverItems = servers.map((server, index) => {
            const isFirst = index === 0;
            if (isFirst) selectedServer = server; // Pre-seleccionar el primero

            return `
                <div class="server-item ${isFirst ? 'selected' : ''}" data-index="${index}">
                    <div class="server-icon">🖥️</div>
                    <div class="server-info">
                        <div class="server-name">${server.name}</div>
                        <div class="server-status ${server.isLocal ? '' : 'online'}">
                            ${server.isLocal ? '🏠 Red local' : '🌐 Acceso remoto'}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        modal.innerHTML = `
            <div class="modal-content">
                <h2>🖥️ Seleccionar Servidor</h2>
                <p>Tienes múltiples servidores Plex disponibles. Selecciona uno:</p>
                <div class="server-list">
                    ${serverItems}
                </div>
                <div class="button-group">
                    <button class="btn-secondary" id="plexdl-cancel">Cancelar</button>
                    <button class="btn-primary" id="plexdl-connect">Conectar</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Event listeners para selección
        const items = modal.querySelectorAll('.server-item');
        items.forEach((item, index) => {
            item.addEventListener('click', () => {
                // Remover selección previa
                items.forEach(i => i.classList.remove('selected'));
                // Seleccionar actual
                item.classList.add('selected');
                selectedServer = servers[index];
            });
        });

        // Botón conectar
        document.getElementById('plexdl-connect').addEventListener('click', () => {
            if (selectedServer) {
                savePreferredServer(selectedServer.clientId);
                modal.remove();
                callback(selectedServer);
            }
        });

        // Botón cancelar
        document.getElementById('plexdl-cancel').addEventListener('click', () => {
            modal.remove();
        });

        // Cerrar al hacer click en el fondo
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    // --- Función principal para seleccionar servidor ---
    function selectServerAndNavigate(forceSelection = false) {
        const token = getToken();
        if (!token) {
            alert('No se encontró el token de Plex. Inicia sesión de nuevo.');
            return;
        }

        const resourcesUrl = `https://plex.tv/api/resources?includeHttps=1&X-Plex-Token=${token}`;
        getXml(resourcesUrl, function(resourcesXml) {
            if (!resourcesXml) {
                console.error('PlexDL: No se pudo obtener la lista de recursos');
                alert('Error al obtener la lista de servidores.');
                return;
            }

            const servers = getAvailableServers(resourcesXml);

            if (servers.length === 0) {
                alert('No se encontró ningún servidor Plex disponible.');
                return;
            }

            console.log(`PlexDL: ${servers.length} servidor(es) encontrado(s)`);

            // Si solo hay un servidor, usarlo directamente con reintento invisible
            if (servers.length === 1) {
                console.log('PlexDL: Solo un servidor disponible, conectando automáticamente...');
                const server = servers[0];
                openLibraryWithFlexibleBaseURI(server.accessToken, server.baseUri);
                return;
            }

            // Si hay múltiples servidores
            const preferredServerId = getPreferredServer();

            // Si se fuerza la selección o no hay preferencia guardada, mostrar selector
            if (forceSelection || !preferredServerId) {
                showServerSelector(servers, (server) => {
                    openLibraryWithFlexibleBaseURI(server.accessToken, server.baseUri);
                });
                return;
            }

            // Intentar usar el servidor preferido
            const preferredServer = servers.find(s => s.clientId === preferredServerId);

            if (preferredServer) {
                console.log('PlexDL: Usando servidor preferido:', preferredServer.name);
                openLibraryWithFlexibleBaseURI(preferredServer.accessToken, preferredServer.baseUri);
            } else {
                // Si el servidor preferido ya no está disponible, mostrar selector
                console.log('PlexDL: Servidor preferido no disponible, mostrando selector...');
                clearPreferredServer();
                showServerSelector(servers, (server) => {
                    openLibraryWithFlexibleBaseURI(server.accessToken, server.baseUri);
                });
            }
        // --- Reintento invisible http/https para la navegación a la biblioteca ---
        function openLibraryWithFlexibleBaseURI(accessToken, baseUri) {
            // Probar primero con el baseUri original, si falla probar con el otro protocolo
            const testUrl = `${baseUri}/library/sections?X-Plex-Token=${accessToken}`;
            function testAndOpen(uri, fallbackUri) {
                fetch(testUrl.replace(baseUri, uri), { method: 'GET', mode: 'cors' })
                    .then(resp => {
                        if (resp.ok) {
                            const libraryUrl = `https://plex-redirect-production.up.railway.app/library?accessToken=${encodeURIComponent(accessToken)}&baseURI=${encodeURIComponent(uri)}`;
                            window.open(libraryUrl, '_blank');
                        } else if (fallbackUri) {
                            testAndOpen(fallbackUri, null);
                        }
                    })
                    .catch(() => {
                        if (fallbackUri) {
                            testAndOpen(fallbackUri, null);
                        }
                    });
            }
            if (baseUri.startsWith('http://')) {
                testAndOpen(baseUri, baseUri.replace('http://', 'https://'));
            } else if (baseUri.startsWith('https://')) {
                testAndOpen(baseUri, baseUri.replace('https://', 'http://'));
            } else {
                // Si no tiene protocolo, probar ambos
                testAndOpen('http://' + baseUri, 'https://' + baseUri);
            }
        }
        });
    }

    // --- Interceptar clicks en el icono de TMDB ---
    function interceptTmdbClicks() {
        document.addEventListener('click', function(e) {
            // Buscar si el click fue en un enlace que contenga themoviedb.org
            let target = e.target;
            let link = null;

            // Subir por el DOM hasta encontrar un <a> o llegar al body
            while (target && target !== document.body) {
                if (target.tagName === 'A' && target.href && target.href.includes('themoviedb.org')) {
                    link = target;
                    break;
                }
                target = target.parentElement;
            }

            if (link) {
                console.log('PlexDL: Click detectado en enlace TMDB:', link.href);

                // Extraer tmdbId de la URL de TMDB
                // Formatos: https://www.themoviedb.org/movie/123456 o /tv/123456
                const tmdbMatch = link.href.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
                if (tmdbMatch) {
                    const tmdbId = tmdbMatch[2];
                    console.log('PlexDL: TMDB ID extraído de URL:', tmdbId);

                    // Intentar obtener el ratingKey de la URL actual de Plex
                    const urlMatch = window.location.href.match(/metadata%2F(\d+)/);
                    if (urlMatch) {
                        const ratingKey = urlMatch[1];
                        saveTmdbId(ratingKey, tmdbId);
                        console.log('PlexDL: ✅ TMDB ID asociado al ratingKey:', ratingKey);
                    } else {
                        console.log('PlexDL: ⚠️ No se pudo extraer ratingKey de la URL actual');
                    }
                }
            }
        }, true); // Usar capture para interceptar antes que Plex
    }

    // --- Extrae baseUri, accessToken y redirige a la web intermedia ---
    function getMetadata(resourcesXml) {
        const match = clientIdRegex.exec(window.location.href);
        if (!match) return alert('No se pudo obtener el clientIdentifier de la URL.');
        const clientId = match[1];

        const accessTokenNode = resourcesXml.evaluate(
            `//Device[@clientIdentifier='${clientId}']/@accessToken`,
            resourcesXml, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        ).singleNodeValue;
        const baseUriNode = resourcesXml.evaluate(
            `//Device[@clientIdentifier='${clientId}']/Connection[@local=0]/@uri`,
            resourcesXml, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        ).singleNodeValue;
        if (!accessTokenNode || !baseUriNode) return alert('No se encontró el token o la URI de conexión.');

        const accessToken = accessTokenNode.textContent;
        const baseUri = baseUriNode.textContent;
        const metaMatch = metadataIdRegex.exec(window.location.href);
        if (!metaMatch) return alert('No estás en una página de media válida.');
        const mediaId = metaMatch[1];

        // Probar el baseUri con ambos protocolos antes de proceder
        function testAndProceed(testUri, fallbackUri) {
            const testUrl = `${testUri}/library/metadata/${mediaId}?X-Plex-Token=${accessToken}`;
            getXml(testUrl, function(xmlMeta) {
                processMetadata(xmlMeta, accessToken, mediaId);
            }, function(workingUri) {
                // El baseUri funcional ya está guardado en lastWorkingBaseUri por getXml
                console.log('PlexDL: BaseURI funcional detectado:', workingUri);
            });
        }

        // Iniciar la prueba con el baseUri original
        if (baseUri.startsWith('http://')) {
            testAndProceed(baseUri, baseUri.replace('http://', 'https://'));
        } else if (baseUri.startsWith('https://')) {
            testAndProceed(baseUri, baseUri.replace('https://', 'http://'));
        } else {
            testAndProceed('https://' + baseUri, 'http://' + baseUri);
        }
    }

    // --- Procesar los metadatos y abrir la web intermedia apropiada ---
    function processMetadata(xmlMeta, accessToken, mediaId) {
        // Detectar tipo de contenido
            const video = xmlMeta.getElementsByTagName('Video')[0];
            const directory = xmlMeta.getElementsByTagName('Directory')[0];

            if (video) {
                const type = video.getAttribute('type');

                if (type === 'movie') {
                    // Es una película - abrir modal de película
                    const title = video.getAttribute('title') || '';
                    const year = video.getAttribute('year') || '';
                    const thumb = video.getAttribute('thumb') || '';
                    const posterUrl = thumb ? `${lastWorkingBaseUri}${thumb}?X-Plex-Token=${accessToken}` : '';
                    const tmdbMatch = video.getAttribute('guid')?.match(/tmdb:\/\/(\d+)/i);
                    let tmdbId = tmdbMatch ? tmdbMatch[1] : '';

                    // Si no hay tmdbId en el XML, intentar recuperarlo del localStorage
                    if (!tmdbId) {
                        tmdbId = getTmdbId(mediaId);
                        console.log('PlexDL: Usando TMDB ID del localStorage:', tmdbId);
                    }

                    // Extraer libraryKey
                    const libraryKey = video.getAttribute('librarySectionID') || '';
                    console.log('PlexDL: librarySectionID encontrado (película):', libraryKey);

                    console.log('PlexDL: Película detectada -', title, `(${year})`, '- tmdbId:', tmdbId);

                    // Obtener URL de descarga del primer archivo
                    const mediaNode = video.getElementsByTagName('Media')[0];
                    if (mediaNode) {
                        const partNode = mediaNode.getElementsByTagName('Part')[0];
                        if (partNode) {
                            const partKey = partNode.getAttribute('key');
                            const fileFull = partNode.getAttribute('file');
                            const fileSizeBytes = partNode.getAttribute('size');
                            const keyBase = partKey.replace(/\/[^\/]+$/, '/');
                            const fileName = fileFull.split('/').pop();
                            let fileSize = '';
                            if (fileSizeBytes) {
                                const gb = parseInt(fileSizeBytes, 10) / (1024 * 1024 * 1024);
                                fileSize = gb >= 1 ? gb.toFixed(2) + ' GBs' : (gb * 1024).toFixed(2) + ' MBs';
                            }
                            const downloadUrl = `${lastWorkingBaseUri}${keyBase}${fileName}?download=0&X-Plex-Token=${accessToken}`;

                            console.log('PlexDL: Datos extraídos -', 'fileName:', fileName, 'fileSize:', fileSize, 'keyBase:', keyBase);

                            // Obtener libraryTitle si tenemos libraryKey
                            if (libraryKey) {
                                const sectionsUrl = `${lastWorkingBaseUri}/library/sections?X-Plex-Token=${accessToken}`;
                                getXml(sectionsUrl, function(sectionsXml) {
                                    let libraryTitle = '';
                                    const directories = sectionsXml.getElementsByTagName('Directory');
                                    for (let i = 0; i < directories.length; i++) {
                                        const section = directories[i];
                                        if (section.getAttribute('key') === libraryKey) {
                                            libraryTitle = section.getAttribute('title') || '';
                                            console.log('PlexDL: libraryTitle encontrado (película):', libraryTitle);
                                            break;
                                        }
                                    }

                                    // Construir URL con libraryKey y libraryTitle (usando movie-redirect)
                                    const redirectUrl = `https://plex-redirect-production.up.railway.app/movie-redirect?accessToken=${encodeURIComponent(accessToken)}&baseURI=${encodeURIComponent(lastWorkingBaseUri)}&ratingKey=${mediaId}&title=${encodeURIComponent(title)}&posterUrl=${encodeURIComponent(posterUrl)}&tmdbId=${tmdbId}&libraryKey=${encodeURIComponent(libraryKey)}&libraryTitle=${encodeURIComponent(libraryTitle)}`;
                                    console.log('PlexDL: URL construida:', redirectUrl);
                                    window.open(redirectUrl, '_blank');
                                });
                            } else {
                                // Si no hay libraryKey, abrir sin él (usando movie-redirect)
                                const redirectUrl = `https://plex-redirect-production.up.railway.app/movie-redirect?accessToken=${encodeURIComponent(accessToken)}&baseURI=${encodeURIComponent(lastWorkingBaseUri)}&ratingKey=${mediaId}&title=${encodeURIComponent(title)}&posterUrl=${encodeURIComponent(posterUrl)}&tmdbId=${tmdbId}`;
                                console.log('PlexDL: URL construida (sin libraryKey):', redirectUrl);
                                window.open(redirectUrl, '_blank');
                            }
                        }
                    }
                } else if (type === 'episode') {
                    // Es un episodio individual - abrir modal de episodio
                    const seasonNumber = video.getAttribute('parentIndex') || '';
                    const episodeNumber = video.getAttribute('index') || '';
                    const seriesTitle = video.getAttribute('grandparentTitle') || '';
                    const parentRatingKey = video.getAttribute('parentRatingKey') || '';
                    const grandparentRatingKey = video.getAttribute('grandparentRatingKey') || '';

                    const redirectUrl = `https://plex-redirect-production.up.railway.app/episode?accessToken=${encodeURIComponent(accessToken)}&baseURI=${encodeURIComponent(lastWorkingBaseUri)}&episodeRatingKey=${mediaId}&seasonNumber=${seasonNumber}&episodeNumber=${episodeNumber}&seriesTitle=${encodeURIComponent(seriesTitle)}&seasonRatingKey=${parentRatingKey}&parentRatingKey=${grandparentRatingKey}`;
                    window.open(redirectUrl, '_blank');
                }
            } else if (directory) {
                const type = directory.getAttribute('type');

                if (type === 'show') {
                    // Es una serie completa - abrir modal de serie con todas las temporadas
                    const title = directory.getAttribute('title') || '';
                    const thumb = directory.getAttribute('thumb') || '';
                    const posterUrl = thumb ? `${lastWorkingBaseUri}${thumb}?X-Plex-Token=${accessToken}` : '';
                    const tmdbMatch = directory.getAttribute('guid')?.match(/tmdb:\/\/(\d+)/i);
                    let tmdbId = tmdbMatch ? tmdbMatch[1] : '';

                    // Si no hay tmdbId en el XML, intentar recuperarlo del localStorage
                    if (!tmdbId) {
                        tmdbId = getTmdbId(mediaId);
                        console.log('PlexDL: Usando TMDB ID del localStorage (serie):', tmdbId);
                    }

                    // Extraer libraryKey y obtener libraryTitle
                    const libraryKey = directory.getAttribute('librarySectionID') || '';
                    console.log('PlexDL: librarySectionID encontrado:', libraryKey);

                    // Obtener nombre de la biblioteca si tenemos libraryKey
                    let libraryTitle = '';
                    if (libraryKey) {
                        const sectionsUrl = `${lastWorkingBaseUri}/library/sections?X-Plex-Token=${accessToken}`;
                        getXml(sectionsUrl, function(sectionsXml) {
                            const directories = sectionsXml.getElementsByTagName('Directory');
                            for (let i = 0; i < directories.length; i++) {
                                const section = directories[i];
                                if (section.getAttribute('key') === libraryKey) {
                                    libraryTitle = section.getAttribute('title') || '';
                                    console.log('PlexDL: libraryTitle encontrado:', libraryTitle);
                                    break;
                                }
                            }

                            // Obtener las temporadas
                            const seasonsUrl = `${lastWorkingBaseUri}/library/metadata/${mediaId}/children?X-Plex-Token=${accessToken}`;
                            getXml(seasonsUrl, function(seasonsXml) {
                                const seasons = [];
                                const seasonDirs = seasonsXml.getElementsByTagName('Directory');

                                for (let i = 0; i < seasonDirs.length; i++) {
                                    const season = seasonDirs[i];
                                    const seasonRatingKey = season.getAttribute('ratingKey');
                                    const seasonTitle = season.getAttribute('title') || '';
                                    const seasonIndex = season.getAttribute('index') || '';
                                    const seasonThumb = season.getAttribute('thumb') || '';
                                    const leafCount = season.getAttribute('leafCount') || '0';

                                    seasons.push({
                                        ratingKey: seasonRatingKey,
                                        title: seasonTitle,
                                        seasonNumber: seasonIndex,
                                        thumb: seasonThumb ? `${lastWorkingBaseUri}${seasonThumb}?X-Plex-Token=${accessToken}` : '',
                                        episodeCount: leafCount
                                    });
                                }

                                const redirectUrl = `https://plex-redirect-production.up.railway.app/series-redirect?accessToken=${encodeURIComponent(accessToken)}&baseURI=${encodeURIComponent(lastWorkingBaseUri)}&ratingKey=${mediaId}&title=${encodeURIComponent(title)}&posterUrl=${encodeURIComponent(posterUrl)}&tmdbId=${tmdbId}&libraryKey=${encodeURIComponent(libraryKey)}&libraryTitle=${encodeURIComponent(libraryTitle)}`;
                                window.open(redirectUrl, '_blank');
                            });
                        });
                    } else {
                        // Si no hay libraryKey, continuar sin él
                        const seasonsUrl = `${lastWorkingBaseUri}/library/metadata/${mediaId}/children?X-Plex-Token=${accessToken}`;
                        getXml(seasonsUrl, function(seasonsXml) {
                            const seasons = [];
                            const seasonDirs = seasonsXml.getElementsByTagName('Directory');

                            for (let i = 0; i < seasonDirs.length; i++) {
                                const season = seasonDirs[i];
                                const seasonRatingKey = season.getAttribute('ratingKey');
                                const seasonTitle = season.getAttribute('title') || '';
                                const seasonIndex = season.getAttribute('index') || '';
                                const seasonThumb = season.getAttribute('thumb') || '';
                                const leafCount = season.getAttribute('leafCount') || '0';

                                seasons.push({
                                    ratingKey: seasonRatingKey,
                                    title: seasonTitle,
                                    seasonNumber: seasonIndex,
                                    thumb: seasonThumb ? `${lastWorkingBaseUri}${seasonThumb}?X-Plex-Token=${accessToken}` : '',
                                    episodeCount: leafCount
                                });
                            }

                            const redirectUrl = `https://plex-redirect-production.up.railway.app/series-redirect?accessToken=${encodeURIComponent(accessToken)}&baseURI=${encodeURIComponent(lastWorkingBaseUri)}&ratingKey=${mediaId}&title=${encodeURIComponent(title)}&posterUrl=${encodeURIComponent(posterUrl)}&tmdbId=${tmdbId}`;
                            window.open(redirectUrl, '_blank');
                        });
                    }
                } else if (type === 'season') {
                    // Es una temporada completa - obtener lista de episodios y abrir modal
                    const seasonTitle = directory.getAttribute('title') || '';
                    const seasonNumber = directory.getAttribute('index') || '';
                    const parentRatingKey = directory.getAttribute('parentRatingKey') || '';

                    // Obtener información de la serie padre
                    const parentUrl = `${lastWorkingBaseUri}/library/metadata/${parentRatingKey}?X-Plex-Token=${accessToken}`;
                    getXml(parentUrl, function(parentXml) {
                        const parentDir = parentXml.getElementsByTagName('Directory')[0];
                        const seriesTitle = parentDir ? parentDir.getAttribute('title') : '';
                        const tmdbMatch = parentDir ? parentDir.getAttribute('guid')?.match(/tmdb:\/\/(\d+)/i) : null;
                        const tmdbId = tmdbMatch ? tmdbMatch[1] : '';

                        const redirectUrl = `https://plex-redirect-production.up.railway.app/list?accessToken=${encodeURIComponent(accessToken)}&baseURI=${encodeURIComponent(lastWorkingBaseUri)}&seasonRatingKey=${mediaId}&seasonNumber=${seasonNumber}&seriesTitle=${encodeURIComponent(seriesTitle)}&tmdbId=${tmdbId}&parentRatingKey=${parentRatingKey}`;
                        window.open(redirectUrl, '_blank');
                    });
                }
            } else {
                alert('No se pudo determinar el tipo de contenido.');
            }
    }

    // --- Inyecta el botón de descarga ---
    function injectDownloadButton(playBtn) {
        if (document.getElementById('plex-download-button')) return;
        const btn = document.createElement('button');
        btn.id = 'plex-download-button';
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="margin-right:8px;"><path d="M16 4C16.5523 4 17 4.44772 17 5V9.2L22.2133 5.55071C22.4395 5.39235 22.7513 5.44737 22.9096 5.6736C22.9684 5.75764 23 5.85774 23 5.96033V18.0397C23 18.3158 22.7761 18.5397 22.5 18.5397C22.3974 18.5397 22.2973 18.5081 22.2133 18.4493L17 14.8V19C17 19.5523 16.5523 20 16 20H2C1.44772 20 1 19.5523 1 19V5C1 4.44772 1.44772 4 2 4H16ZM10 8H8V12H5L9 16L13 12H10V8Z"></path></svg> Descargar';
        btn.className = playBtn.className;
        playBtn.parentNode.insertBefore(btn, playBtn.nextSibling);

        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const token = getToken();
            if (!token) return alert('No se encontró el token de Plex. Inicia sesión de nuevo.');
            const resourcesUrl = `https://plex.tv/api/resources?includeHttps=1&X-Plex-Token=${token}`;
            getXml(resourcesUrl, getMetadata);
        });
    }

    // --- Variables globales para el dropdown ---
    let availableServers = [];
    let dropdownOpen = false;

    // --- Actualizar el dropdown con los servidores disponibles ---
    function updateServerDropdown() {
        const token = getToken();
        if (!token) return;

        const resourcesUrl = `https://plex.tv/api/resources?includeHttps=1&X-Plex-Token=${token}`;
        getXml(resourcesUrl, function(resourcesXml) {
            if (!resourcesXml) return;

            availableServers = getAvailableServers(resourcesXml);
            const preferredServerId = getPreferredServer();
            const currentServer = availableServers.find(s => s.clientId === preferredServerId) || availableServers[0];

            // Actualizar el texto del dropdown
            const dropdown = document.getElementById('plexdl-server-dropdown');
            if (dropdown && currentServer) {
                dropdown.innerHTML = `<span>🖥️</span><span>${currentServer.name}</span><span style="margin-left: 4px;">▼</span>`;
            }

            // Actualizar el menú
            const menu = document.getElementById('plexdl-server-menu');
            if (menu) {
                const menuItems = availableServers.map(server => {
                    const isActive = server.clientId === (currentServer?.clientId || '');
                    return `
                        <div class="menu-item ${isActive ? 'active' : ''}" data-client-id="${server.clientId}">
                            <span class="server-icon-small">🖥️</span>
                            <div class="server-details">
                                <div class="server-name-small">${server.name}</div>
                                <div class="server-status-small">${server.isLocal ? '🏠 Local' : '🌐 Remoto'}</div>
                            </div>
                        </div>
                    `;
                }).join('');

                menu.innerHTML = `
                    <div class="menu-header">Servidores Plex</div>
                    ${menuItems}
                `;

                // Agregar event listeners a los items
                menu.querySelectorAll('.menu-item').forEach(item => {
                    item.addEventListener('click', function() {
                        const clientId = this.getAttribute('data-client-id');
                        const server = availableServers.find(s => s.clientId === clientId);
                        if (server) {
                            savePreferredServer(server.clientId);
                            updateServerDropdown();
                            menu.classList.remove('show');
                            dropdownOpen = false;
                            console.log('PlexDL: Servidor cambiado a:', server.name);
                        }
                    });
                });
            }
        });
    }

    // --- Inyecta el botón de explorar biblioteca en el header ---
    function injectBrowseButton() {
        if (document.getElementById('plexdl-browse-button') && document.getElementById('plexdl-server-selector')) {
            console.log('PlexDL: Elementos ya existen, saltando inyección');
            return;
        }

        console.log('PlexDL: Intentando inyectar elementos PlexDL...');

        let navbarContainer = null;
        let referenceButton = null;

        // Buscar el contenedor del navbar que tiene la barra de búsqueda
        const searchInput = document.querySelector('input[type="text"][placeholder*="earch"]') ||
                          document.querySelector('input[type="search"]');

        if (searchInput) {
            // Navegar hacia arriba hasta encontrar el contenedor principal del header
            let container = searchInput;
            while (container && container !== document.body) {
                const buttons = container.querySelectorAll('button');
                // Buscar un contenedor con múltiples botones (el navbar principal)
                if (buttons.length >= 2 && container.offsetParent !== null) {
                    navbarContainer = container;
                    // Tomar cualquier botón como referencia para copiar estilos
                    const visibleButtons = Array.from(buttons).filter(btn => btn.offsetParent !== null);
                    if (visibleButtons.length > 0) {
                        referenceButton = visibleButtons[0];
                    }
                    console.log('PlexDL: ✅ Navbar container encontrado');
                    break;
                }
                container = container.parentElement;
            }
        }

        if (!navbarContainer) {
            console.log('PlexDL: ❌ No se encontró el navbar container, reintentando...');
            return;
        }

        console.log('PlexDL: Inyectando botones a la derecha del navbar...');

        // Crear el dropdown primero
        if (!document.getElementById('plexdl-server-selector')) {
            const selector = document.createElement('div');
            selector.id = 'plexdl-server-selector';

            const dropdown = document.createElement('div');
            dropdown.id = 'plexdl-server-dropdown';

            const menu = document.createElement('div');
            menu.id = 'plexdl-server-menu';

            selector.appendChild(dropdown);
            selector.appendChild(menu);

            // Event listener para toggle del dropdown
            dropdown.addEventListener('click', function(e) {
                e.stopPropagation();
                dropdownOpen = !dropdownOpen;
                if (dropdownOpen) {
                    menu.classList.add('show');
                    updateServerDropdown();
                } else {
                    menu.classList.remove('show');
                }
            });

            // Cerrar dropdown al hacer click fuera
            document.addEventListener('click', function() {
                if (dropdownOpen) {
                    menu.classList.remove('show');
                    dropdownOpen = false;
                }
            });

            // Agregar al final del navbar (derecha)
            navbarContainer.appendChild(selector);
            updateServerDropdown();
            console.log('PlexDL: ✅ Dropdown agregado a la derecha');
        }

        // Crear el botón de explorar
        if (!document.getElementById('plexdl-browse-button')) {
            const btn = document.createElement('button');
            btn.id = 'plexdl-browse-button';
            btn.innerHTML = '<span>📚</span><span>Explorar Biblioteca</span>';
            // Copiar solo las clases del botón de referencia si existe
            if (referenceButton) {
                btn.className = referenceButton.className;
            } else {
                btn.style.cssText = 'cursor: pointer; display: inline-flex; gap: 8px; align-items: center; padding: 8px 16px; border-radius: 4px; font-weight: 600; background-color: #f3b125; color: black; border: none; margin: 0;';
            }

            btn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                selectServerAndNavigate(false);
            });

            // Agregar al final del navbar (derecha)
            navbarContainer.appendChild(btn);
            console.log('PlexDL: ✅ Botón agregado a la derecha');
        }

        console.log('PlexDL: ✅ Elementos PlexDL inyectados exitosamente a la derecha');
    }

    // --- Observador para inyectar el botón dinámicamente ---
    let lastProcessedMediaUrl = null;
    const observer = new MutationObserver(function() {
        const playBtn = document.querySelector('button[data-testid="preplay-play"]');
        const currentUrl = window.location.href;
        if (playBtn && (currentUrl !== lastProcessedMediaUrl || !document.getElementById('plex-download-button'))) {
            injectDownloadButton(playBtn);
            lastProcessedMediaUrl = currentUrl;
        }
        if (!document.getElementById('plexdl-browse-button')) {
            injectBrowseButton();
        }
        // Actualizar dropdown si existe pero el servidor cambió
        if (document.getElementById('plexdl-server-selector') && availableServers.length > 0) {
            const preferredServerId = getPreferredServer();
            const currentDropdown = document.getElementById('plexdl-server-dropdown');
            if (currentDropdown) {
                const currentServer = availableServers.find(s => s.clientId === preferredServerId);
                if (currentServer) {
                    const expectedText = currentServer.name;
                    if (!currentDropdown.textContent.includes(expectedText)) {
                        updateServerDropdown();
                    }
                }
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // --- Inyección inicial ---
    window.addEventListener('load', function() {
        console.log('PlexDL: Script cargado');
        const playBtn = document.querySelector('button[data-testid="preplay-play"]');
        if (playBtn) {
            injectDownloadButton(playBtn);
            lastProcessedMediaUrl = window.location.href;
        }
        // Intentar inyectar botón de explorar múltiples veces
        setTimeout(injectBrowseButton, 500);
        setTimeout(injectBrowseButton, 1500);
        setTimeout(injectBrowseButton, 3000);
    });

    // También intentar al inicio inmediato
    setTimeout(injectBrowseButton, 100);

    // Activar interceptor de clicks en TMDB
    interceptTmdbClicks();
    console.log('PlexDL: ✅ Interceptor de TMDB activado');
})();
