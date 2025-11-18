const express = require('express');
const app = express();

// Middleware para parsear el body de las peticiones
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (req, res) => {
  const {
    accessToken = '',
    partKey: encodedPartKey = '',
    baseURI = '',
    fileSize = '',
    fileName = '',
    downloadURL = '',
    title = '',
    episodeTitle = '',
    seasonNumber = '',
    episodeNumber = '',
    posterUrl = ''
  } = req.query;
  
  // Decodificar el partKey para mostrar espacios en lugar de %20
  const partKey = decodeURIComponent(encodedPartKey);

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>${title || 'Plex'} - Descarga</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
          background: linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%);
          color: #e5e5e5;
          min-height: 100vh;
          padding: 20px;
        }
        
        .hero-background {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 400px;
          background: linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.95) 100%),
                      ${posterUrl ? `url('${posterUrl}')` : 'linear-gradient(135deg, #e5a00d 0%, #cc8800 100%)'};
          background-size: cover;
          background-position: center top;
          filter: blur(20px);
          opacity: 0.4;
          z-index: 0;
        }
        
        .container {
          position: relative;
          max-width: 900px;
          margin: 0 auto;
          z-index: 1;
        }
        
        .header {
          text-align: center;
          padding: 20px 0 40px 0;
        }
        
        .logo {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-bottom: 10px;
        }
        
        .logo-icon {
          width: 40px;
          height: 40px;
          background: #e5a00d;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 24px;
          color: #000;
        }
        
        .logo-text {
          font-size: 1.8rem;
          font-weight: 700;
          color: #e5a00d;
        }
        
        .tagline {
          color: #999;
          font-size: 0.9rem;
          margin-top: 5px;
        }
        
        .content-card {
          background: rgba(30, 30, 30, 0.95);
          backdrop-filter: blur(10px);
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        
        .media-section {
          display: grid;
          grid-template-columns: 280px 1fr;
          gap: 32px;
          padding: 40px;
        }
        
        .poster-container {
          position: relative;
        }
        
        .poster {
          width: 100%;
          border-radius: 12px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          transition: transform 0.3s ease;
        }
        
        .poster:hover {
          transform: scale(1.02);
        }
        
        .quality-badge {
          position: absolute;
          top: 12px;
          right: 12px;
          background: rgba(229, 160, 13, 0.95);
          color: #000;
          padding: 4px 12px;
          border-radius: 6px;
          font-size: 0.75rem;
          font-weight: 700;
          letter-spacing: 0.5px;
        }
        
        .info-section {
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        
        .title {
          font-size: 2.2rem;
          font-weight: 700;
          color: #fff;
          margin-bottom: 12px;
          line-height: 1.2;
        }
        
        .episode-info {
          display: flex;
          gap: 12px;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        
        .badge {
          background: rgba(255, 255, 255, 0.1);
          padding: 6px 14px;
          border-radius: 20px;
          font-size: 0.85rem;
          font-weight: 500;
          color: #e5a00d;
          border: 1px solid rgba(229, 160, 13, 0.3);
        }
        
        .episode-title {
          font-size: 1.2rem;
          color: #bbb;
          margin: 16px 0;
          font-weight: 500;
        }
        
        .metadata {
          display: flex;
          gap: 24px;
          margin-top: 20px;
          font-size: 0.9rem;
        }
        
        .metadata-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        
        .metadata-label {
          color: #888;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .metadata-value {
          color: #fff;
          font-weight: 600;
        }
        
        .download-section {
          padding: 32px 40px;
          background: rgba(20, 20, 20, 0.6);
          border-top: 1px solid rgba(255, 255, 255, 0.05);
        }
        
        .download-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          width: 100%;
          padding: 18px;
          background: linear-gradient(135deg, #e5a00d 0%, #cc8800 100%);
          color: #000;
          font-weight: 700;
          font-size: 1.1rem;
          border: none;
          border-radius: 12px;
          text-decoration: none;
          transition: all 0.3s ease;
          box-shadow: 0 4px 16px rgba(229, 160, 13, 0.3);
        }
        
        .download-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 24px rgba(229, 160, 13, 0.5);
          background: linear-gradient(135deg, #f5b01d 0%, #dc9800 100%);
        }
        
        .download-icon {
          width: 24px;
          height: 24px;
        }
        
        .status-message {
          text-align: center;
          margin-top: 20px;
          padding: 16px;
          background: rgba(229, 160, 13, 0.1);
          border-radius: 8px;
          border: 1px solid rgba(229, 160, 13, 0.2);
        }
        
        .status-message p {
          color: #e5a00d;
          font-size: 0.95rem;
          margin-bottom: 8px;
        }
        
        .countdown {
          font-weight: 700;
          font-size: 1.1rem;
          color: #fff;
        }
        
        .technical-details {
          margin-top: 24px;
        }
        
        .technical-toggle {
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #888;
          padding: 10px 16px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.85rem;
          transition: all 0.2s;
          width: 100%;
          text-align: left;
        }
        
        .technical-toggle:hover {
          border-color: rgba(229, 160, 13, 0.3);
          color: #e5a00d;
        }
        
        .technical-content {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.3s ease;
        }
        
        .technical-content.open {
          max-height: 500px;
          margin-top: 16px;
        }
        
        .info-table {
          width: 100%;
          border-collapse: collapse;
        }
        
        .info-table td {
          padding: 10px 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          font-size: 0.85rem;
        }
        
        .info-table td.label {
          color: #e5a00d;
          font-weight: 700;
          width: 35%;
        }
        
        .info-table td.value {
          color: #bbb;
          font-family: 'Courier New', monospace;
          font-size: 0.8rem;
          word-break: break-all;
        }
        
        @media (max-width: 768px) {
          .media-section {
            grid-template-columns: 1fr;
            gap: 24px;
            padding: 24px;
          }
          
          .poster-container {
            max-width: 300px;
            margin: 0 auto;
          }
          
          .title {
            font-size: 1.6rem;
          }
          
          .download-section {
            padding: 24px;
          }
        }
      </style>
      <script>
        let countdown = 3;
        window.onload = function() {
          const countdownEl = document.getElementById('countdown');
          const interval = setInterval(function() {
            countdown--;
            if (countdownEl) countdownEl.textContent = countdown;
            if (countdown <= 0) {
              clearInterval(interval);
              window.open("${downloadURL}", '_blank');
            }
          }, 1000);
        }
        
        function toggleTechnical() {
          const content = document.getElementById('technical-content');
          const button = document.getElementById('technical-toggle');
          content.classList.toggle('open');
          button.textContent = content.classList.contains('open') 
            ? '▼ Ocultar detalles técnicos' 
            : '▶ Mostrar detalles técnicos';
        }
      </script>
    </head>
    <body>
      <div class="hero-background"></div>
      
      <div class="container">
        <div class="header">
          <div class="logo">
            <div class="logo-icon">P</div>
            <span class="logo-text">Plex Download</span>
          </div>
          <p class="tagline">Tu contenido, siempre disponible</p>
        </div>
        
        <div class="content-card">
          <div class="media-section">
            <div class="poster-container">
              ${posterUrl ? `
                <img class="poster" src="${posterUrl}" alt="Carátula">
                <div class="quality-badge">HD</div>
              ` : '<div class="poster" style="background: linear-gradient(135deg, #e5a00d 0%, #cc8800 100%); aspect-ratio: 2/3;"></div>'}
            </div>
            
            <div class="info-section">
              <h1 class="title">${title || 'Contenido'}</h1>
              
              <div class="episode-info">
                ${seasonNumber ? `<span class="badge">Temporada ${seasonNumber}</span>` : ''}
                ${episodeNumber ? `<span class="badge">Episodio ${episodeNumber}</span>` : ''}
                ${fileSize ? `<span class="badge">${fileSize}</span>` : ''}
              </div>
              
              ${episodeTitle ? `<div class="episode-title">${episodeTitle}</div>` : ''}
              
              <div class="metadata">
                ${fileName ? `
                  <div class="metadata-item">
                    <span class="metadata-label">Archivo</span>
                    <span class="metadata-value">${fileName.length > 30 ? fileName.substring(0, 30) + '...' : fileName}</span>
                  </div>
                ` : ''}
                ${baseURI ? `
                  <div class="metadata-item">
                    <span class="metadata-label">Servidor</span>
                    <span class="metadata-value">${new URL(baseURI).hostname}</span>
                  </div>
                ` : ''}
              </div>
            </div>
          </div>
          
          <div class="download-section">
            <a class="download-btn" href="${downloadURL}">
              <svg class="download-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z"/>
              </svg>
              Descargar ahora
            </a>
            
            <div class="status-message">
              <p>Tu descarga comenzará automáticamente en <span class="countdown" id="countdown">3</span> segundos</p>
            </div>
            
            <div class="technical-details">
              <button class="technical-toggle" id="technical-toggle" onclick="toggleTechnical()">
                ▶ Mostrar detalles técnicos
              </button>
              <div class="technical-content" id="technical-content">
                <table class="info-table">
                  <tr>
                    <td class="label">Access Token:</td>
                    <td class="value">${accessToken ? accessToken.substring(0, 20) + '...' : 'N/A'}</td>
                  </tr>
                  <tr>
                    <td class="label">Part Key:</td>
                    <td class="value">${partKey}</td>
                  </tr>
                  <tr>
                    <td class="label">Base URL:</td>
                    <td class="value">${baseURI}</td>
                  </tr>
                  <tr>
                    <td class="label">Nombre del archivo:</td>
                    <td class="value">${fileName}</td>
                  </tr>
                  <tr>
                    <td class="label">Tamaño:</td>
                    <td class="value">${fileSize || 'Desconocido'}</td>
                  </tr>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get('/list', (req, res) => {
  const downloadsParam = req.query.downloads;
  
  if (!downloadsParam) {
    return res.status(400).send('No downloads provided');
  }
  
  let downloads = [];
  try {
    downloads = JSON.parse(downloadsParam);
  } catch (e) {
    return res.status(400).send('Invalid downloads format');
  }
  
  generateListPage(downloads, res);
});

app.post('/list', (req, res) => {
  const downloadsParam = req.body.downloads;
  
  if (!downloadsParam) {
    return res.status(400).send('No downloads provided');
  }
  
  let downloads = [];
  try {
    downloads = JSON.parse(downloadsParam);
  } catch (e) {
    return res.status(400).send('Invalid downloads format');
  }
  
  generateListPage(downloads, res);
});

function generateListPage(downloads, res) {
  
  if (!Array.isArray(downloads) || downloads.length === 0) {
    return res.status(400).send('No downloads found');
  }
  
  // Obtener información de la serie/temporada
  const firstDownload = downloads[0];
  const seriesTitle = firstDownload.title || 'Contenido';
  const seasonNumber = firstDownload.seasonNumber || '';
  const seriesPoster = firstDownload.seasonPoster || firstDownload.posterUrl || '';
  
  // Datos adicionales para simular el modal de Plex
  const seasonOverview = 'El viaje de Ash a lo más alto de la Liga Añil continúa, pero ¿peligrará su suerte por su amistad con Ritchie, su competidor en la Liga Pokémon? Una vez terminado su viaje por Kanto, Ash descubre que aún quedan bastantes cosas por ver y hacer cuando el Profesor Oak los envía a él y a sus...';
  const seasonYear = '2000';
  
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>${seriesTitle}${seasonNumber ? ` - Temporada ${seasonNumber}` : ''} - Lista de Descargas</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
          background: linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%);
          color: #e5e5e5;
          min-height: 100vh;
          padding: 20px;
        }
        
        .hero-background {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 400px;
          background: linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.95) 100%),
                      ${seriesPoster ? `url('${seriesPoster}')` : 'linear-gradient(135deg, #e5a00d 0%, #cc8800 100%)'};
          background-size: cover;
          background-position: center top;
          filter: blur(20px);
          opacity: 0.4;
          z-index: 0;
        }
        
        .container {
          position: relative;
          max-width: 1200px;
          margin: 0 auto;
          z-index: 1;
        }
        
        .header {
          text-align: center;
          padding: 20px 0 40px 0;
        }
        
        .logo {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-bottom: 10px;
        }
        
        .logo-icon {
          width: 40px;
          height: 40px;
          background: #e5a00d;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 24px;
          color: #000;
        }
        
        .logo-text {
          font-size: 1.8rem;
          font-weight: 700;
          color: #e5a00d;
        }
        
        .series-header {
          background: rgba(30, 30, 30, 0.95);
          backdrop-filter: blur(10px);
          border-radius: 16px;
          padding: 40px;
          margin-bottom: 32px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.05);
          display: grid;
          grid-template-columns: 280px 1fr;
          gap: 40px;
          align-items: center;
        }
        
        .series-poster {
          width: 100%;
          border-radius: 12px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          aspect-ratio: 2/3;
          object-fit: cover;
        }
        
        .series-info h1 {
          font-size: 2.8rem;
          font-weight: 700;
          color: #fff;
          margin-bottom: 16px;
          line-height: 1.2;
        }
        
        .season-overview {
          color: rgba(255, 255, 255, 0.85);
          font-size: 1rem;
          line-height: 1.5;
          margin: 16px 0 20px 0;
          max-width: 90%;
        }
        
        .series-meta {
          display: flex;
          gap: 12px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }
        
        .meta-badge {
          background: rgba(229, 160, 13, 0.15);
          border: 1px solid rgba(229, 160, 13, 0.3);
          padding: 10px 18px;
          border-radius: 20px;
          font-size: 0.95rem;
          font-weight: 600;
          color: #e5a00d;
        }
        
        .download-season-btn {
          margin-top: 4px;
          padding: 16px 32px;
          background: linear-gradient(135deg, #e5a00d 0%, #cc8800 100%);
          color: #000;
          border: none;
          border-radius: 10px;
          font-weight: 700;
          font-size: 1.1rem;
          cursor: pointer;
          transition: all 0.3s ease;
          display: inline-flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 4px 16px rgba(229, 160, 13, 0.3);
        }
        
        .download-season-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 24px rgba(229, 160, 13, 0.5);
        }
        
        .download-season-btn svg {
          width: 22px;
          height: 22px;
        }
        
        .episodes-grid {
          display: grid;
          gap: 20px;
          margin-bottom: 32px;
        }
        
        .episode-card {
          background: rgba(30, 30, 30, 0.95);
          backdrop-filter: blur(10px);
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.05);
          transition: all 0.3s ease;
        }
        
        .episode-card:hover {
          border-color: rgba(229, 160, 13, 0.3);
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        }
        
        .episode-main {
          display: grid;
          grid-template-columns: 280px 1fr auto;
          gap: 24px;
          align-items: flex-start;
          padding: 20px;
        }
        
        .episode-poster {
          width: 100%;
          border-radius: 8px;
          aspect-ratio: 16/9;
          object-fit: cover;
        }
        
        .episode-info {
          flex: 1;
          padding-top: 4px;
        }
        
        .episode-number {
          font-size: 0.85rem;
          color: #e5a00d;
          font-weight: 600;
          margin-bottom: 8px;
        }
        
        .episode-title {
          font-size: 1.3rem;
          font-weight: 600;
          color: #fff;
          margin-bottom: 8px;
        }
        
        .episode-meta {
          display: flex;
          gap: 16px;
          font-size: 0.85rem;
          color: #888;
          margin-bottom: 12px;
        }
        
        .episode-meta span {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        
        .filename-container {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .filename-text {
          font-family: 'Courier New', monospace;
        }
        
        .expand-btn {
          background: rgba(229, 160, 13, 0.2);
          border: 1px solid rgba(229, 160, 13, 0.4);
          color: #e5a00d;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.75rem;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .expand-btn:hover {
          background: rgba(229, 160, 13, 0.3);
        }
        
        .episode-description {
          color: rgba(255, 255, 255, 0.75);
          font-size: 0.9rem;
          line-height: 1.4;
          margin-top: 8px;
        }
        
        .download-btn {
          padding: 12px 24px;
          background: linear-gradient(135deg, #e5a00d 0%, #cc8800 100%);
          color: #000;
          border: none;
          border-radius: 8px;
          font-weight: 700;
          font-size: 0.95rem;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          gap: 8px;
          white-space: nowrap;
        }
        
        .download-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(229, 160, 13, 0.4);
        }
        
        .download-btn svg {
          width: 20px;
          height: 20px;
        }
        
        .episode-technical {
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          padding: 0;
        }
        
        .technical-header {
          padding: 16px 20px;
          cursor: pointer;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 8px;
          transition: background 0.2s;
          user-select: none;
          background: rgba(255, 255, 255, 0.02);
        }
        
        .technical-header:hover {
          background: rgba(255, 255, 255, 0.05);
        }
        
        .technical-text {
          font-size: 0.95rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.9);
        }
        
        .technical-text {
          font-size: 0.95rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.9);
        }
        
        .technical-toggle {
          width: 20px;
          height: 20px;
          transition: transform 0.3s;
          color: rgba(255, 255, 255, 0.7);
        }
        
        .technical-toggle.open {
          transform: rotate(180deg);
        }
        
        .technical-content {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.3s ease;
        }
        
        .technical-content.open {
          max-height: 800px;
        }
        
        .technical-list {
          padding: 20px;
        }
        
        .technical-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 12px 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        
        .technical-row:last-child {
          border-bottom: none;
        }
        
        .technical-label {
          font-size: 0.85rem;
          color: #e5a00d;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          min-width: 120px;
        }
        
        .technical-value {
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.9);
          font-family: 'Courier New', monospace;
          word-break: break-all;
          text-align: right;
          flex: 1;
          margin-left: 20px;
        }
        
        .technical-section {
          background: rgba(30, 30, 30, 0.95);
          backdrop-filter: blur(10px);
          border-radius: 12px;
          padding: 24px;
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        
        .technical-toggle {
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #888;
          padding: 12px 16px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.9rem;
          transition: all 0.2s;
          width: 100%;
          text-align: left;
          font-weight: 600;
        }
        
        .technical-toggle:hover {
          border-color: rgba(229, 160, 13, 0.3);
          color: #e5a00d;
        }
        
        .technical-content {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.3s ease;
        }
        
        .technical-content.open {
          max-height: 2000px;
          margin-top: 16px;
        }
        
        .info-table {
          width: 100%;
          border-collapse: collapse;
        }
        
        .info-table td {
          padding: 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          font-size: 0.85rem;
        }
        
        .info-table td.label {
          color: #e5a00d;
          font-weight: 700;
          width: 30%;
        }
        
        .info-table td.value {
          color: #bbb;
          font-family: 'Courier New', monospace;
          font-size: 0.8rem;
          word-break: break-all;
        }
        
        @media (max-width: 968px) {
          .series-header {
            grid-template-columns: 1fr;
            text-align: center;
          }
          
          .series-poster {
            max-width: 200px;
            margin: 0 auto;
          }
          
          .series-meta {
            justify-content: center;
            flex-wrap: wrap;
          }
          
          .episode-card {
            grid-template-columns: 1fr;
            text-align: center;
          }
          
          .episode-poster {
            max-width: 300px;
            margin: 0 auto;
          }
          
          .download-btn {
            width: 100%;
            justify-content: center;
          }
        }
      </style>
      <script>
        function downloadEpisode(index) {
          const downloads = ${JSON.stringify(downloads)};
          const download = downloads[index];
          
          const params = new URLSearchParams();
          params.set('accessToken', download.accessToken);
          params.set('partKey', download.partKey);
          params.set('baseURI', download.baseURI);
          params.set('fileSize', download.fileSize);
          params.set('fileName', download.fileName);
          params.set('downloadURL', download.downloadURL);
          params.set('title', download.title);
          params.set('episodeTitle', download.episodeTitle);
          params.set('seasonNumber', download.seasonNumber);
          params.set('episodeNumber', download.episodeNumber);
          params.set('posterUrl', download.posterUrl);
          
          // Descarga directa sin abrir nueva pestaña
          location.href = 'https://plex-redirect.onrender.com/?' + params.toString();
        }
        
        function downloadAllEpisodes() {
          const downloads = ${JSON.stringify(downloads)};
          let currentIndex = 0;
          
          function downloadNext() {
            if (currentIndex >= downloads.length) {
              alert('¡Descarga de temporada completa iniciada!');
              return;
            }
            
            const download = downloads[currentIndex];
            const params = new URLSearchParams();
            params.set('accessToken', download.accessToken);
            params.set('partKey', download.partKey);
            params.set('baseURI', download.baseURI);
            params.set('fileSize', download.fileSize);
            params.set('fileName', download.fileName);
            params.set('downloadURL', download.downloadURL);
            params.set('title', download.title);
            params.set('episodeTitle', download.episodeTitle);
            params.set('seasonNumber', download.seasonNumber);
            params.set('episodeNumber', download.episodeNumber);
            params.set('posterUrl', download.posterUrl);
            
            // Abrir en nueva pestaña para descarga automática
            window.open('https://plex-redirect.onrender.com/?' + params.toString(), '_blank');
            
            currentIndex++;
            
            // Continuar con el siguiente episodio después de 3 segundos
            if (currentIndex < downloads.length) {
              setTimeout(downloadNext, 3000);
            }
          }
          
          downloadNext();
        }
        
        function toggleTechnical(index) {
          const content = document.getElementById('technical-content-' + index);
          const toggle = document.getElementById('technical-toggle-' + index);
          const headers = document.querySelectorAll(`[onclick="toggleTechnical(${index})"]`);
          const text = headers.length > 0 ? headers[0].querySelector('.technical-text') : null;
          
          content.classList.toggle('open');
          toggle.classList.toggle('open');
          
          // Cambiar el texto del botón
          if (text) {
            if (content.classList.contains('open')) {
              text.textContent = 'Ocultar detalles técnicos';
            } else {
              text.textContent = 'Mostrar detalles técnicos';
            }
          }
        }
        
        function toggleFilename(index, fullName) {
          const filenameElement = document.getElementById('filename-' + index);
          const button = filenameElement.nextElementSibling;
          
          if (filenameElement.textContent.includes('...')) {
            filenameElement.textContent = fullName;
            button.textContent = '-';
          } else {
            filenameElement.textContent = fullName.length > 40 ? fullName.substring(0, 40) + '...' : fullName;
            button.textContent = '+';
          }
        }
      </script>
    </head>
    <body>
      <div class="hero-background"></div>
      
      <div class="container">
        <div class="header">
          <div class="logo">
            <div class="logo-icon">P</div>
            <span class="logo-text">Plex Download</span>
          </div>
        </div>
        
        <div class="series-header">
          ${seriesPoster ? `<img class="series-poster" src="${seriesPoster}" alt="${seriesTitle}">` : ''}
          <div class="series-info">
            <h1>${seriesTitle}</h1>
            <div class="series-meta">
              ${seasonNumber ? `<div class="meta-badge">Temporada ${seasonNumber}</div>` : ''}
              ${seasonYear ? `<div class="meta-badge">${seasonYear}</div>` : ''}
              <div class="meta-badge">${downloads.length} ${downloads.length === 1 ? 'Episodio' : 'Episodios'}</div>
            </div>
            <div class="season-overview">${seasonOverview}</div>
            <button class="download-season-btn" onclick="downloadAllEpisodes()">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width: 24px; height: 24px;">
                <path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z"/>
              </svg>
              Descargar Temporada
            </button>
          </div>
        </div>
        
        <div class="episodes-grid">
          ${downloads.map((download, index) => `
            <div class="episode-card">
              <div class="episode-main">
                ${download.posterUrl ? `<img class="episode-poster" src="${download.posterUrl}" alt="${download.episodeTitle}">` : `<div class="episode-poster" style="background: linear-gradient(135deg, #333 0%, #222 100%);"></div>`}
                
                <div class="episode-info">
                  <div class="episode-number">
                    ${download.seasonNumber ? `Temporada ${download.seasonNumber}` : ''} 
                    ${download.episodeNumber ? `• Episodio ${download.episodeNumber}` : ''}
                  </div>
                  <div class="episode-title">${download.episodeTitle || download.fileName}</div>
                  <div class="episode-meta">
                    ${download.fileSize ? `<span>📦 ${download.fileSize}</span>` : ''}
                    <div class="filename-container">
                      <span>📄 
                        <span class="filename-text" id="filename-${index}">${download.fileName.length > 40 ? download.fileName.substring(0, 40) + '...' : download.fileName}</span>
                        ${download.fileName.length > 40 ? `<button class="expand-btn" onclick="toggleFilename(${index}, ${JSON.stringify(download.fileName)})">+</button>` : ''}
                      </span>
                    </div>
                  </div>
                  <div class="episode-description">
                    ${download.episodeDescription || 'Ash y sus amigos continúan su aventura en esta emocionante entrega donde enfrentarán nuevos desafíos y conocerán Pokémon increíbles.'}
                  </div>
                </div>
                
                <button class="download-btn" onclick="downloadEpisode(${index})">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z"/>
                  </svg>
                  Descargar
                </button>
              </div>
              
              <div class="episode-technical">
                <div class="technical-header" onclick="toggleTechnical(${index})">
                  <span class="technical-text">Mostrar detalles técnicos</span>
                  <svg class="technical-toggle" id="technical-toggle-${index}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 14.975L6.172 9.147l1.414-1.414L12 12.147l4.414-4.414 1.414 1.414z"/>
                  </svg>
                </div>
                <div class="technical-content" id="technical-content-${index}">
                  <div class="technical-list">
                    <div class="technical-row">
                      <div class="technical-label">Access Token:</div>
                      <div class="technical-value">${download.accessToken ? download.accessToken.substring(0, 20) + '...' : 'N/A'}</div>
                    </div>
                    <div class="technical-row">
                      <div class="technical-label">Part Key:</div>
                      <div class="technical-value">${decodeURIComponent(download.partKey)}</div>
                    </div>
                    <div class="technical-row">
                      <div class="technical-label">Base URL:</div>
                      <div class="technical-value">${download.baseURI}</div>
                    </div>
                    <div class="technical-row">
                      <div class="technical-label">Nombre del archivo:</div>
                      <div class="technical-value">${download.fileName}</div>
                    </div>
                    <div class="technical-row">
                      <div class="technical-label">Tamaño:</div>
                      <div class="technical-value">${download.fileSize || 'Desconocido'}</div>
                    </div>
                    <div class="technical-row">
                      <div class="technical-label">URL de descarga:</div>
                      <div class="technical-value">${download.downloadURL}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
        
        <div class="technical-section" style="display: none;">
          ${downloads.map((download, index) => `
            <div style="margin-bottom: ${index < downloads.length - 1 ? '16px' : '0'};">
              <button class="technical-toggle" id="technical-toggle-${index}" onclick="toggleTechnical(${index})">
                ▶ Detalles técnicos - ${download.episodeTitle || download.fileName}
              </button>
              <div class="technical-content" id="technical-content-${index}">
                <table class="info-table">
                  <tr>
                    <td class="label">Access Token:</td>
                    <td class="value">${download.accessToken ? download.accessToken.substring(0, 20) + '...' : 'N/A'}</td>
                  </tr>
                  <tr>
                    <td class="label">Part Key:</td>
                    <td class="value">${decodeURIComponent(download.partKey)}</td>
                  </tr>
                  <tr>
                    <td class="label">Base URL:</td>
                    <td class="value">${download.baseURI}</td>
                  </tr>
                  <tr>
                    <td class="label">Nombre del archivo:</td>
                    <td class="value">${download.fileName}</td>
                  </tr>
                  <tr>
                    <td class="label">Tamaño:</td>
                    <td class="value">${download.fileSize || 'Desconocido'}</td>
                  </tr>
                  <tr>
                    <td class="label">URL de descarga:</td>
                    <td class="value">${download.downloadURL}</td>
                  </tr>
                </table>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </body>
    </html>
  `);
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
});
