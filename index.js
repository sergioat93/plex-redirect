const express = require('express');
const app = express();

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
          text-transform: uppercase;
          letter-spacing: 0.5px;
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

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
});
