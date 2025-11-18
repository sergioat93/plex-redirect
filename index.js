const express = require('express');
const app = express();

app.get('/', (req, res) => {
  const {
    accessToken = '',
    partKey = '',
    baseURI = '',
    fileSize = '',
    fileName = '',
    downloadURL = ''
  } = req.query;

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>PlexDL - Descarga</title>
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
        h1 {
          font-size: 2rem;
          margin-bottom: 16px;
          color: #f5c518;
        }
        .info {
          margin-bottom: 24px;
        }
        .info label {
          font-weight: bold;
          color: #e0b316;
        }
        .info span {
          color: #fff;
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
        }
      </style>
      <script>
        window.onload = function() {
          setTimeout(function() {
            window.location.href = "${downloadURL}";
          }, 2000);
        }
      </script>
    </head>
    <body>
      <div class="container">
        <h1>PlexDL - Descarga</h1>
        <div class="info">
          <div><label>Access Token:</label> <span>${accessToken}</span></div>
          <div><label>Part Key Node:</label> <span>${partKey}</span></div>
          <div><label>Base URI:</label> <span>${baseURI}</span></div>
          <div><label>File Name:</label> <span>${fileName}</span></div>
          <div><label>File Size:</label> <span>${fileSize ? fileSize : 'Desconocido'}</span></div>
        </div>
        <a class="download-link" href="${downloadURL}">Descargar ahora</a>
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
