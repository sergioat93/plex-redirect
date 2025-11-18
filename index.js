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
      <title>Scloud - Descarga Plex</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {
          font-family: 'Segoe UI', Arial, sans-serif;
          background: #18181b;
          color: #f5c518;
          margin: 0;
          padding: 0;
        }
        .container {
          max-width: 500px;
          margin: 40px auto;
          background: #23232a;
          border-radius: 12px;
          box-shadow: 0 4px 24px #0006;
          padding: 32px 24px;
        }
        .poster {
          width: 100%;
          max-width: 220px;
          border-radius: 8px;
          margin: 0 auto 16px auto;
          display: block;
        }
        h1 {
          font-size: 2rem;
          margin-bottom: 8px;
          color: #f5c518;
          text-align: center;
        }
        .subtitle {
          font-size: 1.1rem;
          color: #fff;
          text-align: center;
          margin-bottom: 16px;
        }
        .info-table {
          width: 100%;
          margin: 24px 0;
          border-collapse: collapse;
        }
        .info-table td {
          padding: 6px 8px;
          border-bottom: 1px solid #333;
          color: #fff;
        }
        .info-table td.label {
          color: #e0b316;
          font-weight: bold;
          width: 40%;
        }
        .download-link {
          display: block;
          margin: 24px 0;
          padding: 12px 0;
          background: #f5c518;
          color: #23232a;
          font-weight: bold;
          text-align: center;
          border-radius: 6px;
          text-decoration: none;
          font-size: 1.1rem;
          transition: background 0.2s;
        }
        .download-link:hover {
          background: #e0b316;
        }
        .back-btn {
          display: block;
          margin: 0 auto;
          padding: 10px 24px;
          background: #23232a;
          color: #f5c518;
          border: 2px solid #f5c518;
          border-radius: 6px;
          font-weight: bold;
          text-decoration: none;
          transition: background 0.2s, color 0.2s;
        }
        .back-btn:hover {
          background: #f5c518;
          color: #23232a;
        }
        .wait {
          margin-top: 24px;
          color: #e0b316;
          font-size: 1.1rem;
          text-align: center;
        }
      </style>
      <script>
        window.onload = function() {
          setTimeout(function() {
            window.open("${downloadURL}", '_blank');
          }, 2000);
        }
      </script>
    </head>
    <body>
      <div class="container">
        <h1>Scloud - Descarga Plex</h1>
        ${posterUrl ? `<img class="poster" src="${posterUrl}" alt="Carátula">` : ''}
        <div class="subtitle">
          ${title ? `<b>${title}</b>` : ''} 
          ${seasonNumber ? ` - Temporada ${seasonNumber}` : ''} 
          ${episodeNumber ? ` - Capítulo ${episodeNumber}` : ''} 
          ${episodeTitle ? `<br>${episodeTitle}` : ''}
        </div>
        <a class="download-link" href="${downloadURL}">Descargar ahora</a>
        <table class="info-table">
          <tr><td class="label">Access Token</td><td>${accessToken}</td></tr>
          <tr><td class="label">Part Key Node</td><td>${partKey}</td></tr>
          <tr><td class="label">Base URL</td><td>${baseURI}</td></tr>
          <tr><td class="label">File Name</td><td>${fileName}</td></tr>
          <tr><td class="label">File Size</td><td>${fileSize ? fileSize : 'Desconocido'}</td></tr>
        </table>
        <a class="back-btn" href="javascript:window.history.back()">Volver a Plex</a>
        <div class="wait">Por favor, espera a que tu descarga comience automáticamente...</div>
      </div>
    </body>
    </html>
  `);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
});
