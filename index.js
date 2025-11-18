const express = require('express');
const https = require('https');
const app = express();

// ⚠️ IMPORTANTE: Reemplaza esto con tu propia API Key de TMDB
// Obtén una gratis en: https://www.themoviedb.org/settings/api
const TMDB_API_KEY = '5aaa0a6844d70ade130e868275ee2cc2';

// Función helper para hacer requests HTTPS que devuelve JSON
function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

// Función helper para hacer requests HTTPS que devuelve texto plano (XML)
function httpsGetXML(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

// Función simple para parsear XML de Plex (sin dependencias externas)
function parseXML(xmlString) {
    const result = {
        MediaContainer: {
            Metadata: []
        }
    };
    
    // Extraer todos los elementos <Video> o <Directory>
    const videoRegex = /<Video[^>]*>(.*?)<\/Video>|<Video([^>]*)\/>/gs;
    const matches = xmlString.matchAll(videoRegex);
    
    for (const match of matches) {
        const videoTag = match[0];
        const episode = {};
        
        // Extraer atributos del tag Video
        const attrRegex = /(\w+)="([^"]*)"/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(videoTag)) !== null) {
            const [, key, value] = attrMatch;
            episode[key] = value;
        }
        
        // Buscar tags Media y Part dentro del Video
        const mediaRegex = /<Media[^>]*>/g;
        const mediaMatch = mediaRegex.exec(videoTag);
        if (mediaMatch) {
            episode.Media = [{}];
            const mediaTag = mediaMatch[0];
            
            // Extraer atributos de Media
            const mediaAttrRegex = /(\w+)="([^"]*)"/g;
            let mediaAttrMatch;
            while ((mediaAttrMatch = mediaAttrRegex.exec(mediaTag)) !== null) {
                const [, key, value] = mediaAttrMatch;
                episode.Media[0][key] = value;
            }
            
            // Buscar tag Part
            const partRegex = /<Part[^>]*>/g;
            const partMatch = partRegex.exec(videoTag);
            if (partMatch) {
                episode.Media[0].Part = [{}];
                const partTag = partMatch[0];
                
                // Extraer atributos de Part
                const partAttrRegex = /(\w+)="([^"]*)"/g;
                let partAttrMatch;
                while ((partAttrMatch = partAttrRegex.exec(partTag)) !== null) {
                    const [, key, value] = partAttrMatch;
                    episode.Media[0].Part[0][key] = value;
                }
            }
        }
        
        result.MediaContainer.Metadata.push(episode);
    }
    
    return result;
}

// Función para obtener datos de TMDB
async function fetchTMDBData(tmdbId, type = 'tv') {
    try {
        const url = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`;
        
        const data = await httpsGet(url);
        return {
            title: data.name || data.title,
            overview: data.overview,
            posterPath: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
            releaseYear: data.first_air_date ? new Date(data.first_air_date).getFullYear() : 
                        data.release_date ? new Date(data.release_date).getFullYear() : null
        };
    } catch (error) {
        console.error('Error fetching TMDB data:', error);
        return null;
    }
}

// Función para obtener datos específicos de temporada de TMDB
async function fetchTMDBSeasonData(tmdbId, seasonNumber = 1) {
    try {
        const url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}?api_key=${TMDB_API_KEY}&language=es-ES`;
        
        const data = await httpsGet(url);
        return {
            name: data.name,
            overview: data.overview,
            posterPath: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
            airDate: data.air_date
        };
    } catch (error) {
        console.error('Error fetching TMDB season data:', error);
        return null;
    }
}

// Función para obtener datos completos de película desde TMDB
async function fetchTMDBMovieData(tmdbId) {
    try {
        // Obtener datos básicos de la película
        const movieUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES&append_to_response=credits,videos`;
        const movieData = await httpsGet(movieUrl);
        
        // Extraer géneros
        const genres = movieData.genres ? movieData.genres.map(g => g.name) : [];
        
        // Extraer director del crew
        const director = movieData.credits && movieData.credits.crew 
            ? movieData.credits.crew.find(person => person.job === 'Director')?.name || 'N/A'
            : 'N/A';
        
        // Extraer primeros 5 actores del cast
        const cast = movieData.credits && movieData.credits.cast
            ? movieData.credits.cast.slice(0, 5).map(actor => actor.name).join(', ')
            : 'N/A';
        
        // Extraer trailer de YouTube
        const trailer = movieData.videos && movieData.videos.results
            ? movieData.videos.results.find(video => video.type === 'Trailer' && video.site === 'YouTube')
            : null;
        
        // Formatear presupuesto y recaudación
        const formatCurrency = (amount) => {
            if (!amount || amount === 0) return 'N/A';
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(amount);
        };
        
        // Formatear duración
        const formatRuntime = (minutes) => {
            if (!minutes) return 'N/A';
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            return `${hours}h ${mins}min`;
        };
        
        return {
            title: movieData.title || 'Sin título',
            originalTitle: movieData.original_title || 'N/A',
            tagline: movieData.tagline || '',
            overview: movieData.overview || 'Sin descripción disponible',
            posterPath: movieData.poster_path ? `https://image.tmdb.org/t/p/w500${movieData.poster_path}` : null,
            backdropPath: movieData.backdrop_path ? `https://image.tmdb.org/t/p/original${movieData.backdrop_path}` : null,
            releaseDate: movieData.release_date || 'N/A',
            year: movieData.release_date ? new Date(movieData.release_date).getFullYear() : 'N/A',
            runtime: formatRuntime(movieData.runtime),
            runtimeMinutes: movieData.runtime || 0,
            genres: genres,
            genresString: genres.join(', ') || 'N/A',
            rating: movieData.vote_average ? movieData.vote_average.toFixed(1) : 'N/A',
            voteCount: movieData.vote_count ? movieData.vote_count.toLocaleString('es-ES') : 'N/A',
            budget: formatCurrency(movieData.budget),
            revenue: formatCurrency(movieData.revenue),
            director: director,
            cast: cast,
            originalLanguage: movieData.original_language ? movieData.original_language.toUpperCase() : 'N/A',
            countries: movieData.production_countries ? movieData.production_countries.map(c => c.name).join(', ') : 'N/A',
            imdbId: movieData.imdb_id || null,
            trailerKey: trailer ? trailer.key : null
        };
    } catch (error) {
        console.error('Error fetching TMDB movie data:', error);
        return null;
    }
}

// Función para obtener datos completos de serie desde TMDB
async function fetchTMDBSeriesData(tmdbId) {
    try {
        // Obtener datos básicos de la serie
        const seriesUrl = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES&append_to_response=credits,videos,external_ids`;
        const seriesData = await httpsGet(seriesUrl);
        
        // Extraer géneros
        const genres = seriesData.genres ? seriesData.genres.map(g => g.name) : [];
        
        // Extraer creadores
        const creators = seriesData.created_by && seriesData.created_by.length > 0
            ? seriesData.created_by.map(c => c.name).join(', ')
            : 'N/A';
        
        // Extraer primeros 5 actores del cast
        const cast = seriesData.credits && seriesData.credits.cast
            ? seriesData.credits.cast.slice(0, 5).map(actor => actor.name).join(', ')
            : 'N/A';
        
        // Extraer trailer de YouTube
        const trailer = seriesData.videos && seriesData.videos.results
            ? seriesData.videos.results.find(video => video.type === 'Trailer' && video.site === 'YouTube')
            : null;
        
        // Determinar estado de la serie
        const getStatus = (status) => {
            const statusMap = {
                'Returning Series': 'En emisión',
                'Ended': 'Finalizada',
                'Canceled': 'Cancelada',
                'In Production': 'En producción',
                'Planned': 'Planificada'
            };
            return statusMap[status] || status || 'Desconocido';
        };
        
        // Calcular duración promedio de episodios
        const formatRuntime = (minutes) => {
            if (!minutes || minutes.length === 0) return 'N/A';
            const avgMinutes = Array.isArray(minutes) ? minutes[0] : minutes;
            return `${avgMinutes} min`;
        };
        
        return {
            title: seriesData.name || 'Sin título',
            originalTitle: seriesData.original_name || 'N/A',
            tagline: seriesData.tagline || '',
            overview: seriesData.overview || 'Sin descripción disponible',
            posterPath: seriesData.poster_path ? `https://image.tmdb.org/t/p/w500${seriesData.poster_path}` : null,
            backdropPath: seriesData.backdrop_path ? `https://image.tmdb.org/t/p/original${seriesData.backdrop_path}` : null,
            firstAirDate: seriesData.first_air_date || 'N/A',
            lastAirDate: seriesData.last_air_date || 'N/A',
            year: seriesData.first_air_date ? new Date(seriesData.first_air_date).getFullYear() : 'N/A',
            status: getStatus(seriesData.status),
            numberOfSeasons: seriesData.number_of_seasons || 0,
            numberOfEpisodes: seriesData.number_of_episodes || 0,
            episodeRuntime: formatRuntime(seriesData.episode_run_time),
            genres: genres,
            genresString: genres.join(', ') || 'N/A',
            rating: seriesData.vote_average ? seriesData.vote_average.toFixed(1) : 'N/A',
            voteCount: seriesData.vote_count ? seriesData.vote_count.toLocaleString('es-ES') : 'N/A',
            creators: creators,
            cast: cast,
            originalLanguage: seriesData.original_language ? seriesData.original_language.toUpperCase() : 'N/A',
            countries: seriesData.production_countries ? seriesData.production_countries.map(c => c.name).join(', ') : 'N/A',
            networks: seriesData.networks ? seriesData.networks.map(n => n.name).join(', ') : 'N/A',
            imdbId: seriesData.external_ids && seriesData.external_ids.imdb_id ? seriesData.external_ids.imdb_id : null,
            trailerKey: trailer ? trailer.key : null,
            inProduction: seriesData.in_production || false
        };
    } catch (error) {
        console.error('Error fetching TMDB series data:', error);
        return null;
    }
}

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
    posterUrl = '',
    autoDownload = ''
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
      <link rel="icon" type="image/x-icon" href="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/favicon.ico">
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
          color: #888;
          font-weight: 500;
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
        const autoDownload = '${autoDownload}' === 'true';
        
        window.onload = function() {
          if (autoDownload) {
            // Descarga automática inmediata para múltiples descargas
            window.location.href = "${downloadURL}";
            return;
          }
          
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
                ${baseURI && baseURI.startsWith('http') ? `
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
                    <td class="label">Access Token</td>
                    <td class="value">${accessToken ? accessToken.substring(0, 20) + '...' : 'N/A'}</td>
                  </tr>
                  <tr>
                    <td class="label">Part Key</td>
                    <td class="value">${partKey}</td>
                  </tr>
                  <tr>
                    <td class="label">Base URL</td>
                    <td class="value">${baseURI}</td>
                  </tr>
                  <tr>
                    <td class="label">Nombre del archivo</td>
                    <td class="value">${fileName}</td>
                  </tr>
                  <tr>
                    <td class="label">Tamaño</td>
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

app.get('/list', async (req, res) => {
  const downloadsParam = req.query.downloads;
  const seasonRatingKey = req.query.seasonRatingKey;
  const accessToken = req.query.accessToken;
  const baseURI = req.query.baseURI;
  const seasonNumber = req.query.seasonNumber;
  const seriesTitleParam = req.query.seriesTitle;
  const tmdbId = req.query.tmdbId;
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  
  let downloads = [];
  
  // Si recibimos seasonRatingKey, obtener episodios de Plex
  if (seasonRatingKey && accessToken && baseURI) {
    try {
      const seasonUrl = `${baseURI}/library/metadata/${seasonRatingKey}/children?X-Plex-Token=${accessToken}`;
      const xmlData = await httpsGetXML(seasonUrl);
      const seasonData = parseXML(xmlData);
      
      if (seasonData && seasonData.MediaContainer && seasonData.MediaContainer.Metadata) {
        const episodes = seasonData.MediaContainer.Metadata;
        
        // Construir array de downloads con la información de cada episodio
        downloads = episodes.map(ep => {
          let fileUrl = null;
          let fileSize = 0;
          let fileName = '';
          let partKey = '';
          
          if (ep.Media && ep.Media[0] && ep.Media[0].Part && ep.Media[0].Part[0]) {
            const part = ep.Media[0].Part[0];
            fileName = part.file ? part.file.split('/').pop() : '';
            fileSize = parseInt(part.size) || 0;
            partKey = part.key || '';
            fileUrl = `${baseURI}${part.key}?download=1&X-Plex-Token=${accessToken}`;
          }
          
          // Formatear tamaño de archivo
          let fileSizeFormatted = 'N/A';
          if (fileSize > 0) {
            const gb = fileSize / (1024 * 1024 * 1024);
            const mb = fileSize / (1024 * 1024);
            fileSizeFormatted = gb >= 1 ? `${gb.toFixed(2)} GB` : `${mb.toFixed(2)} MB`;
          }
          
          // Decodificar entidades HTML en el nombre de archivo
          const decodedFileName = fileName
            .replace(/&#191;/g, '¿')
            .replace(/&#233;/g, 'é')
            .replace(/&#225;/g, 'á')
            .replace(/&#237;/g, 'í')
            .replace(/&#243;/g, 'ó')
            .replace(/&#250;/g, 'ú')
            .replace(/&#241;/g, 'ñ')
            .replace(/&#193;/g, 'Á')
            .replace(/&#201;/g, 'É')
            .replace(/&#205;/g, 'Í')
            .replace(/&#211;/g, 'Ó')
            .replace(/&#218;/g, 'Ú')
            .replace(/&#209;/g, 'Ñ')
            .replace(/&#161;/g, '¡')
            .replace(/&#63;/g, '?')
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#39;/g, "'");
          
          return {
            episodeTitle: ep.title || '',
            episodeNumber: parseInt(ep.index) || 0,
            seasonNumber: parseInt(seasonNumber) || parseInt(ep.parentIndex) || 0,
            url: fileUrl,
            fileName: decodedFileName,
            fileSize: fileSize,
            fileSizeFormatted: fileSizeFormatted,
            posterUrl: ep.thumb ? `${baseURI}${ep.thumb}?X-Plex-Token=${accessToken}` : null,
            summary: ep.summary || '',
            accessToken: accessToken,
            partKey: encodeURIComponent(partKey),
            baseURI: baseURI
          };
        });
        
        // Agregar información de la temporada al inicio
        if (downloads.length > 0) {
          downloads.unshift({
            isSeasonInfo: true,
            seriesTitle: seriesTitleParam || '',
            seasonTitle: `Temporada ${seasonNumber}`,
            seasonNumber: parseInt(seasonNumber) || 0,
            seasonSummary: '',
            seasonYear: '',
            seasonPoster: '',
            tmdbId: tmdbId || null
          });
        }
      }
    } catch (error) {
      console.error('Error fetching season data from Plex:', error);
      return res.status(500).send('Error fetching season data');
    }
  }
  // Si recibimos downloads directamente
  else if (downloadsParam) {
    try {
      downloads = JSON.parse(downloadsParam);
    } catch (e) {
      return res.status(400).send('Invalid downloads format');
    }
  }
  // Si no tenemos ninguno de los dos
  else {
    return res.status(400).send('No downloads or season data provided');
  }
  
  if (!Array.isArray(downloads) || downloads.length === 0) {
    return res.status(400).send('No downloads found');
  }
  
  // Separar información de temporada de los episodios
  let seasonInfo = null;
  let episodes = downloads;
  
  if (downloads[0] && downloads[0].isSeasonInfo) {
    seasonInfo = downloads[0];
    episodes = downloads.slice(1);
  }
  
  // Calcular paginación
  const totalEpisodes = episodes.length;
  const totalPages = Math.ceil(totalEpisodes / pageSize);
  const startIndex = (page - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalEpisodes);
  const currentPageEpisodes = episodes.slice(startIndex, endIndex);
  
  // Calcular tamaño total de la temporada
  const totalSizeBytes = episodes.reduce((sum, ep) => sum + (ep.fileSize || 0), 0);
  const totalSizeGB = (totalSizeBytes / (1024 * 1024 * 1024)).toFixed(2);
  const totalSizeTB = (totalSizeBytes / (1024 * 1024 * 1024 * 1024)).toFixed(2);
  const totalSizeFormatted = totalSizeBytes >= 1024 * 1024 * 1024 * 1024 
    ? `${totalSizeTB} TB` 
    : `${totalSizeGB} GB`;
  
  // Obtener información de la serie/temporada
  const firstEpisode = episodes[0];
  let seriesTitle = seasonInfo && seasonInfo.seriesTitle ? seasonInfo.seriesTitle : (seasonInfo ? seasonInfo.seasonTitle : (firstEpisode.title || 'Contenido'));
  const seasonNumberFromEpisode = firstEpisode.seasonNumber || seasonInfo?.seasonNumber || '';
  let seasonSummary = seasonInfo ? seasonInfo.seasonSummary : '';
  let seasonYear = seasonInfo ? seasonInfo.seasonYear : '';
  let seasonPoster = seasonInfo ? seasonInfo.seasonPoster : (firstEpisode.posterUrl || '');
  let backdropPath = null;
  let imdbId = null;
  let trailerKey = null;
  
  // Intentar mejorar datos con TMDB si disponible
  if (seasonInfo && seasonInfo.tmdbId) {
    try {
      // Obtener datos completos de la serie
      const seriesData = await fetchTMDBSeriesData(seasonInfo.tmdbId);
      
      // Obtener datos específicos de la temporada
      const seasonData = await fetchTMDBSeasonData(seasonInfo.tmdbId, seasonNumberFromEpisode);
      
      if (seasonData && seasonData.overview) {
        seasonSummary = seasonData.overview;
      } else if (seriesData && seriesData.overview && !seasonSummary) {
        seasonSummary = seriesData.overview;
      }
      
      if (seasonData && seasonData.posterPath) {
        seasonPoster = seasonData.posterPath;
      } else if (seriesData && seriesData.posterPath && (!seasonPoster || seasonPoster.includes('thumb'))) {
        seasonPoster = seriesData.posterPath;
      }
      
      if (seriesData && seriesData.year && !seasonYear) {
        seasonYear = seriesData.year.toString();
      }
      
      // Obtener backdrop, IMDB ID y trailer de la serie
      if (seriesData) {
        backdropPath = seriesData.backdropPath;
        imdbId = seriesData.imdbId;
        trailerKey = seriesData.trailerKey;
      }
    } catch (error) {
      console.error('Error fetching TMDB data:', error);
    }
  }
  
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>${seriesTitle}${seasonNumberFromEpisode ? ` - Temporada ${seasonNumberFromEpisode}` : ''} - Lista de Descargas</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="icon" type="image/x-icon" href="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/favicon.ico">
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
                      ${seasonPoster ? `url('${seasonPoster}')` : 'linear-gradient(135deg, #e5a00d 0%, #cc8800 100%)'};
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
          gap: 32px;
          align-items: flex-start;
        }
        
        .series-poster {
          width: 100%;
          aspect-ratio: 3/4;
          border-radius: 12px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          object-fit: cover;
        }
        
        .series-info h1 {
          font-size: 2.5rem;
          font-weight: 700;
          color: #fff;
          margin-bottom: 16px;
        }
        
        .series-meta {
          display: flex;
          gap: 16px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }
        
        .meta-badge {
          background: rgba(229, 160, 13, 0.15);
          border: 1px solid rgba(229, 160, 13, 0.3);
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 0.9rem;
          font-weight: 600;
          color: #e5a00d;
        }
        
        .series-description {
          color: #bbb;
          font-size: 1rem;
          line-height: 1.6;
          margin-bottom: 24px;
          position: relative;
        }
        
        .description-text {
          transition: all 0.3s ease;
        }
        
        .expand-description-btn {
          background: transparent;
          border: 1px solid rgba(229, 160, 13, 0.3);
          color: #e5a00d;
          padding: 6px 12px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.85rem;
          transition: all 0.2s;
          margin-top: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        
        .expand-description-btn:hover {
          background: rgba(229, 160, 13, 0.1);
          border-color: rgba(229, 160, 13, 0.5);
        }
        
        .expand-description-btn svg {
          transition: transform 0.3s ease;
        }
        
        .expand-description-btn.expanded svg {
          transform: rotate(180deg);
        }
        
        .action-buttons {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
        }
        
        .download-season-btn, .download-page-btn {
          padding: 14px 28px;
          background: linear-gradient(135deg, #e5a00d 0%, #cc8800 100%);
          color: #000;
          border: none;
          border-radius: 12px;
          font-weight: 700;
          font-size: 1.1rem;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          gap: 10px;
          white-space: nowrap;
          box-shadow: 0 4px 16px rgba(229, 160, 13, 0.3);
        }
        
        .download-page-btn {
          background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
          color: #fff;
          box-shadow: 0 4px 16px rgba(37, 99, 235, 0.3);
        }
        
        .download-season-btn:hover, .download-page-btn:hover {
          transform: translateY(-2px);
        }
        
        .download-season-btn:hover {
          box-shadow: 0 6px 24px rgba(229, 160, 13, 0.5);
        }
        
        .download-page-btn:hover {
          box-shadow: 0 6px 24px rgba(37, 99, 235, 0.5);
        }
        
        .download-season-btn:disabled, .download-page-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }
        
        .download-season-btn svg, .download-page-btn svg {
          width: 24px;
          height: 24px;
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
          display: grid;
          grid-template-columns: 200px 1fr auto;
          gap: 24px;
          align-items: flex-start;
          padding: 16px;
          position: relative;
        }
        
        .episode-card:hover {
          border-color: rgba(229, 160, 13, 0.3);
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        }
        
        .episode-poster {
          width: 100%;
          border-radius: 8px;
          aspect-ratio: 16/9;
          object-fit: cover;
          position: sticky;
          top: 0;
        }
        
        .episode-info {
          flex: 1;
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
        
        .technical-toggle {
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #888;
          padding: 8px 12px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.8rem;
          transition: all 0.2s;
          margin-top: 8px;
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
          margin-top: 12px;
        }
        
        .info-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.8rem;
        }
        
        .info-table td {
          padding: 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        
        .info-table td.label {
          color: #888;
          font-weight: 600;
          width: 30%;
        }
        
        .info-table td.value {
          color: #bbb;
          font-family: 'Courier New', monospace;
          font-size: 0.75rem;
          word-break: break-all;
        }
        
        .filename-container {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .filename-text {
          flex: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          transition: all 0.3s ease;
        }
        
        .filename-text.expanded {
          white-space: normal;
          word-break: break-word;
        }
        
        .expand-btn {
          background: rgba(229, 160, 13, 0.2);
          border: 1px solid rgba(229, 160, 13, 0.3);
          color: #e5a00d;
          padding: 2px 6px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.7rem;
          transition: all 0.2s;
          min-width: 60px;
          text-align: center;
        }
        
        .expand-btn:hover {
          background: rgba(229, 160, 13, 0.3);
        }
        
        .filename-meta {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .expand-btn-meta {
          background: rgba(229, 160, 13, 0.2);
          border: 1px solid rgba(229, 160, 13, 0.3);
          color: #e5a00d;
          padding: 2px 6px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.7rem;
          transition: all 0.2s;
          min-width: 20px;
          height: 20px;
          text-align: center;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .expand-btn-meta:hover {
          background: rgba(229, 160, 13, 0.3);
        }
        
        .pagination-controls {
          background: rgba(30, 30, 30, 0.95);
          backdrop-filter: blur(10px);
          border-radius: 16px;
          padding: 24px;
          margin-bottom: 32px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        
        .breadcrumbs {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 20px;
          font-size: 0.9rem;
          color: #888;
          justify-content: center;
          flex-wrap: wrap;
        }
        
        .breadcrumbs .current {
          color: #e5a00d;
          font-weight: 600;
        }
        
        .pagination-nav {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 16px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }
        
        .page-btn {
          padding: 10px 16px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: #ccc;
          cursor: pointer;
          transition: all 0.2s;
          font-size: 0.9rem;
          text-decoration: none;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .page-btn:hover {
          background: rgba(229, 160, 13, 0.15);
          border-color: rgba(229, 160, 13, 0.3);
          color: #e5a00d;
        }
        
        .page-btn.current {
          background: rgba(229, 160, 13, 0.2);
          border-color: rgba(229, 160, 13, 0.4);
          color: #e5a00d;
          font-weight: 600;
        }
        
        .page-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        
        .episode-jump {
          display: flex;
          align-items: center;
          gap: 12px;
          justify-content: center;
          margin-top: 16px;
          flex-wrap: wrap;
        }
        
        .episode-jump input {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          padding: 8px 12px;
          color: #fff;
          font-size: 0.9rem;
          width: 80px;
          text-align: center;
        }
        
        .episode-jump button {
          padding: 8px 16px;
          background: rgba(229, 160, 13, 0.2);
          border: 1px solid rgba(229, 160, 13, 0.3);
          border-radius: 6px;
          color: #e5a00d;
          cursor: pointer;
          transition: all 0.2s;
          font-size: 0.9rem;
        }
        
        .episode-jump button:hover {
          background: rgba(229, 160, 13, 0.3);
        }
        
        .progress-indicator {
          margin-top: 16px;
          padding: 12px;
          background: rgba(229, 160, 13, 0.1);
          border-radius: 8px;
          border: 1px solid rgba(229, 160, 13, 0.2);
          display: none;
        }
        
        .progress-indicator.show {
          display: block;
        }
        
        .progress-text {
          color: #e5a00d;
          font-size: 0.9rem;
          margin-bottom: 8px;
        }
        
        .progress-bar {
          width: 100%;
          height: 4px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 2px;
          overflow: hidden;
        }
        
        .progress-fill {
          height: 100%;
          background: #e5a00d;
          width: 0%;
          transition: width 0.3s ease;
        }
        
        @media (max-width: 968px) {
          .series-header {
            grid-template-columns: 1fr;
            text-align: center;
            padding: 24px;
          }
          
          .series-poster {
            max-width: 250px;
            margin: 0 auto;
          }
          
          .series-meta, .action-buttons {
            justify-content: center;
            flex-wrap: wrap;
          }
          
          .action-buttons {
            flex-direction: column;
            align-items: center;
          }
          
          .download-season-btn, .download-page-btn {
            width: 100%;
            max-width: 300px;
            justify-content: center;
          }
          
          .pagination-controls {
            padding: 16px;
          }
          
          .pagination-nav {
            flex-wrap: wrap;
            gap: 8px;
          }
          
          .page-btn {
            font-size: 0.8rem;
            padding: 8px 12px;
          }
          
          .breadcrumbs {
            font-size: 0.8rem;
            text-align: center;
          }
          
          .episode-jump {
            flex-direction: column;
            gap: 8px;
            text-align: center;
          }
          
          .episode-jump input, .episode-jump button {
            width: 120px;
          }
          
          .episode-card {
            grid-template-columns: 1fr;
            text-align: center;
            padding: 12px;
          }
          
          .episode-poster {
            max-width: 250px;
            margin: 0 auto;
          }
          
          .episode-meta {
            justify-content: center;
          }
          
          .download-btn {
            width: 100%;
            max-width: 200px;
            justify-content: center;
            margin: 0 auto;
          }
        }
        
        @media (max-width: 640px) {
          .container {
            padding: 10px;
          }
          
          .series-header {
            padding: 16px;
          }
          
          .series-info h1 {
            font-size: 1.8rem;
          }
          
          .pagination-nav {
            justify-content: center;
          }
          
          .page-btn {
            padding: 6px 10px;
            font-size: 0.75rem;
          }
          
          .episode-card {
            padding: 8px;
          }
          
          .episode-title {
            font-size: 1.1rem;
          }
          
          .meta-badge {
            font-size: 0.8rem;
            padding: 6px 12px;
          }
        }
      </style>
      <script>
        const allEpisodes = ${JSON.stringify(episodes)};
        const currentPageEpisodes = ${JSON.stringify(currentPageEpisodes)};
        const page = ${page};
        const pageSize = ${pageSize};
        const totalPages = ${totalPages};
        const startIndex = ${startIndex};
        
        // Función para formatear tamaño de archivo
        function formatFileSize(bytes) {
          if (!bytes || bytes === 0) return 'N/A';
          const gb = bytes / (1024 * 1024 * 1024);
          const mb = bytes / (1024 * 1024);
          if (gb >= 1) {
            return gb.toFixed(2) + ' GB';
          } else {
            return mb.toFixed(2) + ' MB';
          }
        }
        
        let isDownloading = false;
        let downloadIndex = 0;
        
        function downloadEpisode(globalIndex, fromSequential = false) {
          const download = allEpisodes[globalIndex];
          
          // Descargar directamente usando la URL de Plex
          if (download.url) {
            // Crear un elemento <a> temporal para forzar la descarga
            const link = document.createElement('a');
            link.href = download.url;
            link.download = download.fileName || 'episode.mkv';
            link.target = '_blank';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }
          
          // Continuar con la siguiente descarga si es secuencial
          if (fromSequential) {
            downloadIndex++;
            if (downloadIndex < allEpisodes.length) {
              updateProgress();
              setTimeout(() => downloadEpisode(downloadIndex, true), 1500);
            } else {
              finishSequentialDownload();
            }
          }
        }
        
        function downloadCurrentPage() {
          if (isDownloading) return;
          
          isDownloading = true;
          let pageDownloadIndex = 0;
          
          const btn = document.getElementById('download-page-btn');
          
          if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12,1A11,11,0,1,0,23,12,11,11,0,0,0,12,1Zm0,19a8,8,0,1,1,8-8A8,8,0,0,1,12,20Z" opacity=".25"/><path d="M12,4a8,8,0,0,1,7.89,6.7A1.53,1.53,0,0,0,21.38,12h0a1.5,1.5,0,0,0,1.48-1.75,11,11,0,0,0-21.72,0A1.5,1.5,0,0,0,2.62,12h0a1.53,1.53,0,0,0,1.49-1.3A8,8,0,0,1,12,4Z"><animateTransform attributeName="transform" dur="0.75s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12"/></path></svg> Descargando...';
          }
          
          function downloadNextPageEpisode() {
            if (pageDownloadIndex >= currentPageEpisodes.length) {
              // Terminar descarga de página
              isDownloading = false;
              if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z"/></svg> Descargar Esta Página (' + currentPageEpisodes.length + ' episodios)';
              }
              return;
            }
            
            const globalIndex = startIndex + pageDownloadIndex;
            downloadEpisode(globalIndex);
            pageDownloadIndex++;
            
            setTimeout(downloadNextPageEpisode, 1500);
          }
          
          downloadNextPageEpisode();
        }
        
        function downloadSeasonSequential() {
          if (isDownloading) return;
          
          isDownloading = true;
          downloadIndex = 0;
          
          const btn = document.getElementById('download-season-btn');
          const progress = document.getElementById('progress-indicator');
          
          btn.disabled = true;
          btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12,1A11,11,0,1,0,23,12,11,11,0,0,0,12,1Zm0,19a8,8,0,1,1,8-8A8,8,0,0,1,12,20Z" opacity=".25"/><path d="M12,4a8,8,0,0,1,7.89,6.7A1.53,1.53,0,0,0,21.38,12h0a1.5,1.5,0,0,0,1.48-1.75,11,11,0,0,0-21.72,0A1.5,1.5,0,0,0,2.62,12h0a1.53,1.53,0,0,0,1.49-1.3A8,8,0,0,1,12,4Z"><animateTransform attributeName="transform" dur="0.75s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12"/></path></svg> Descargando...';
          if (progress) progress.classList.add('show');
          
          updateProgress();
          downloadEpisode(0, true);
        }
        
        function updateProgress() {
          const progressText = document.getElementById('progress-text');
          const progressFill = document.getElementById('progress-fill');
          if (!progressText || !progressFill) return;
          
          const percentage = Math.round((downloadIndex / allEpisodes.length) * 100);
          
          progressText.textContent = \`Descargando episodio \${downloadIndex + 1} de \${allEpisodes.length} (\${percentage}%)\`;
          progressFill.style.width = percentage + '%';
        }
        
        function finishSequentialDownload() {
          isDownloading = false;
          const btn = document.getElementById('download-season-btn');
          const progress = document.getElementById('progress-indicator');
          
          btn.disabled = false;
          btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z"/></svg> Descargar Temporada Completa';
          
          if (progress) {
            setTimeout(() => {
              progress.classList.remove('show');
            }, 2000);
          }
        }
        
        function jumpToEpisode() {
          const episodeNumber = parseInt(document.getElementById('episode-input').value);
          if (episodeNumber && episodeNumber >= 1 && episodeNumber <= allEpisodes.length) {
            const targetPage = Math.ceil(episodeNumber / pageSize);
            const downloadsParam = encodeURIComponent(JSON.stringify(${JSON.stringify(downloads)}));
            window.location.href = \`/list?downloads=\${downloadsParam}&page=\${targetPage}&pageSize=\${pageSize}\`;
          } else {
            alert('Por favor, ingresa un número de episodio válido (1-' + allEpisodes.length + ')');
          }
        }
        
        function toggleTechnical(index) {
          const content = document.getElementById('technical-content-' + index);
          const button = document.getElementById('technical-toggle-' + index);
          content.classList.toggle('open');
          button.textContent = content.classList.contains('open') 
            ? '▼ Ocultar detalles técnicos' 
            : '▶ Mostrar detalles técnicos';
        }
        
        function toggleFilename(index) {
          const text = document.getElementById('filename-' + index);
          const button = document.getElementById('expand-btn-' + index);
          text.classList.toggle('expanded');
          button.textContent = text.classList.contains('expanded') ? 'Contraer' : 'Expandir';
        }
        
        function toggleFilenameMeta(index) {
          const text = document.getElementById('filename-meta-' + index);
          const button = document.getElementById('expand-btn-meta-' + index);
          const currentFileName = allEpisodes[startIndex + index].fileName;
          
          if (button.textContent === '+') {
            text.textContent = currentFileName;
            button.textContent = '-';
          } else {
            text.textContent = currentFileName.length > 40 ? currentFileName.substring(0, 40) + '...' : currentFileName;
            button.textContent = '+';
          }
        }
        
        function toggleSynopsis() {
          const synopsis = document.getElementById('synopsis-text');
          const button = document.getElementById('synopsis-toggle');
          const ellipsis = document.getElementById('synopsis-ellipsis');
          if (synopsis && button) {
            if (synopsis.style.maxHeight === 'none') {
              synopsis.style.maxHeight = '10.2em';
              button.textContent = 'Ver más';
              if (ellipsis) ellipsis.style.display = 'block';
            } else {
              synopsis.style.maxHeight = 'none';
              button.textContent = 'Ver menos';
              if (ellipsis) ellipsis.style.display = 'none';
            }
          }
        }
      </script>
    </head>
    <body>
      <!-- Header con backdrop y poster -->
      <div style="background: linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(26,26,26,1) 100%), ${backdropPath ? `url('${backdropPath}')` : 'linear-gradient(135deg, #e5a00d 0%, #cc8800 100%)'}; background-size: cover; background-position: center; padding: 3rem; position: relative;">
        <div style="max-width: 1400px; margin: 0 auto; display: grid; grid-template-columns: 280px 1fr; gap: 2rem; align-items: flex-start;">
          <!-- Poster de la temporada -->
          ${seasonPoster ? `<img src="${seasonPoster}" alt="${seriesTitle}" style="width: 100%; aspect-ratio: 2/3; border-radius: 12px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6); object-fit: cover;">` : '<div style="width: 100%; aspect-ratio: 2/3; border-radius: 12px; background: linear-gradient(135deg, #333 0%, #222 100%);"></div>'}
          
          <!-- Información -->
          <div style="position: relative; z-index: 2;">
            <h1 style="font-size: 3rem; font-weight: 700; margin-bottom: 0.5rem; text-shadow: 2px 2px 8px rgba(0, 0, 0, 0.9); line-height: 1.1; color: white;">${seriesTitle}</h1>
            <div style="color: rgba(255, 255, 255, 0.9); font-size: 1.1rem; font-style: italic; text-shadow: 1px 1px 4px rgba(0, 0, 0, 0.8); margin-bottom: 1rem;">Temporada ${seasonNumberFromEpisode}</div>
            
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem;">
              <div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">
                ${totalSizeFormatted ? `<span style="background: #e5a00d; color: #000; padding: 0.4rem 0.8rem; border-radius: 20px; font-weight: 600; font-size: 0.9rem;">${totalSizeFormatted}</span>` : ''}
                ${seasonYear ? `<span style="background: #e5a00d; color: #000; padding: 0.4rem 0.8rem; border-radius: 20px; font-weight: 600; font-size: 0.9rem;">${seasonYear}</span>` : ''}
                <span style="background: rgba(249, 168, 37, 0.2); border: 2px solid #f9a825; padding: 0.3rem 0.8rem; border-radius: 20px; color: #f9a825; font-weight: 600;">${totalEpisodes} Episodio${totalEpisodes !== 1 ? 's' : ''}</span>
              </div>
              
              <div style="display: flex; gap: 0.75rem; align-items: center;">
                ${seasonInfo && seasonInfo.tmdbId ? `
                  <a href="https://www.themoviedb.org/tv/${seasonInfo.tmdbId}" target="_blank" rel="noopener noreferrer" title="Ver en TMDB" style="display: inline-block;">
                    <img src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/TMDB.png" alt="TMDB" style="width: 32px; height: 32px; transition: transform 0.2s ease, filter 0.2s ease; filter: brightness(0.9);" onmouseover="this.style.transform='scale(1.1)'; this.style.filter='brightness(1.1)';" onmouseout="this.style.transform='scale(1)'; this.style.filter='brightness(0.9)';">
                  </a>
                ` : ''}
                ${imdbId ? `
                  <a href="https://www.imdb.com/title/${imdbId}" target="_blank" rel="noopener noreferrer" title="Ver en IMDb" style="display: inline-block;">
                    <img src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/IMDB.png" alt="IMDb" style="width: 32px; height: 32px; transition: transform 0.2s ease, filter 0.2s ease; filter: brightness(0.9);" onmouseover="this.style.transform='scale(1.1)'; this.style.filter='brightness(1.1)';" onmouseout="this.style.transform='scale(1)'; this.style.filter='brightness(0.9)';">
                  </a>
                ` : ''}
                ${trailerKey ? `
                  <a href="https://www.youtube.com/watch?v=${trailerKey}" target="_blank" rel="noopener noreferrer" title="Ver trailer" style="display: inline-block;">
                    <img src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/youtube.png" alt="YouTube" style="width: 32px; height: 32px; transition: transform 0.2s ease, filter 0.2s ease; filter: brightness(0.9);" onmouseover="this.style.transform='scale(1.1)'; this.style.filter='brightness(1.1)';" onmouseout="this.style.transform='scale(1)'; this.style.filter='brightness(0.9)';">
                  </a>
                ` : ''}
              </div>
            </div>
            
            ${seasonSummary ? `
              <div style="position: relative; margin-bottom: 1.5rem;">
                <div id="synopsis-text" style="line-height: 1.7; font-size: 1.08rem; text-align: justify; margin-bottom: 0.5rem; color: #cccccc; max-height: 10.2em; overflow: hidden; transition: max-height 0.3s ease; position: relative;">
                  ${seasonSummary}
                </div>
                <div id="synopsis-ellipsis" style="text-align: left; display: block;">
                  <button id="synopsis-toggle" onclick="toggleSynopsis()" style="background: transparent; border: none; color: #e5a00d; font-size: 0.95rem; font-weight: 600; cursor: pointer; padding: 0; transition: all 0.2s ease; text-decoration: underline;" onmouseover="this.style.color='#f0b825';" onmouseout="this.style.color='#e5a00d';">Ver más</button>
                </div>
              </div>
            ` : ''}
            
            <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
              <button class="download-season-btn" id="download-season-btn" onclick="downloadSeasonSequential()" style="background: linear-gradient(135deg, #e5a00d 0%, #cc8800 100%); color: #000; border: none; padding: 1rem 2rem; border-radius: 12px; font-size: 1.1rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 0.75rem; transition: all 0.3s ease; box-shadow: 0 4px 16px rgba(229, 160, 13, 0.3); flex: 1;justify-content: center;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 24px rgba(229, 160, 13, 0.4)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 16px rgba(229, 160, 13, 0.3)';">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z"/>
                </svg>
                Descargar Temporada Completa
              </button>
              
              <button onclick="window.history.back()" style="background: rgba(255, 255, 255, 0.1); color: #e5e5e5; border: 1px solid rgba(255, 255, 255, 0.2); padding: 1rem 2rem; border-radius: 12px; font-size: 1.1rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 0.75rem; transition: all 0.3s ease;" onmouseover="this.style.background='rgba(255, 255, 255, 0.15)'; this.style.transform='translateY(-2px)';" onmouseout="this.style.background='rgba(255, 255, 255, 0.1)'; this.style.transform='translateY(0)';">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                </svg>
                Volver a Serie
              </button>
            </div>
            
            <div class="progress-indicator" id="progress-indicator" style="margin-top: 1.5rem; display: none;">
              <div class="progress-text" id="progress-text" style="color: #e5a00d; font-weight: 600; margin-bottom: 0.5rem;"></div>
              <div class="progress-bar" style="background: rgba(255, 255, 255, 0.1); height: 8px; border-radius: 4px; overflow: hidden;">
                <div class="progress-fill" id="progress-fill" style="background: linear-gradient(90deg, #e5a00d 0%, #f0b825 100%); height: 100%; width: 0%; transition: width 0.3s ease;"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Lista de episodios -->
      <div style="max-width: 1400px; margin: 0 auto; padding: 2rem;">
        
        <div class="episodes-grid">
          ${currentPageEpisodes.map((download, index) => {
            const globalIndex = startIndex + index;
            return `
            <div class="episode-card">
              ${download.posterUrl ? `<img class="episode-poster" src="${download.posterUrl}" alt="${download.episodeTitle}">` : `<div class="episode-poster" style="background: linear-gradient(135deg, #333 0%, #222 100%);"></div>`}
              
              <div class="episode-info">
                <div class="episode-number">
                  ${download.seasonNumber ? `Temporada ${download.seasonNumber}` : ''} 
                  ${download.episodeNumber ? `• Episodio ${download.episodeNumber}` : ''}
                </div>
                <div class="episode-title">${download.episodeTitle || download.fileName}</div>
                <div class="episode-meta">
                  ${download.fileSizeFormatted ? `<span>📦 ${download.fileSizeFormatted}</span>` : ''}
                  <div class="filename-meta">
                    <span>📄 <span class="filename-text" id="filename-meta-${index}">${download.fileName.length > 40 ? download.fileName.substring(0, 40) + '...' : download.fileName}</span></span>
                    ${download.fileName.length > 40 ? `<button class="expand-btn-meta" id="expand-btn-meta-${index}" onclick="toggleFilenameMeta(${index})">+</button>` : ''}
                  </div>
                </div>
                
                <button class="technical-toggle" id="technical-toggle-${index}" onclick="toggleTechnical(${index})">
                  ▶ Mostrar detalles técnicos
                </button>
                <div class="technical-content" id="technical-content-${index}">
                  <table class="info-table">
                    <tr>
                      <td class="label">Access Token</td>
                      <td class="value">${download.accessToken ? download.accessToken.substring(0, 20) + '...' : 'N/A'}</td>
                    </tr>
                    <tr>
                      <td class="label">Part Key</td>
                      <td class="value">${decodeURIComponent(download.partKey)}</td>
                    </tr>
                    <tr>
                      <td class="label">Base URL</td>
                      <td class="value">${download.baseURI}</td>
                    </tr>
                    <tr>
                      <td class="label">Nombre del archivo</td>
                      <td class="value">${download.fileName}</td>
                    </tr>
                    <tr>
                      <td class="label">Tamaño</td>
                      <td class="value">${download.fileSize || 'Desconocido'}</td>
                    </tr>
                    <tr>
                      <td class="label">URL de descarga</td>
                      <td class="value">${download.downloadURL}</td>
                    </tr>
                  </table>
                </div>
              </div>
              
              <button class="download-btn" onclick="downloadEpisode(${globalIndex})">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z"/>
                </svg>
                Descargar
              </button>
            </div>
          `}).join('')}
        </div>
        
        ${totalPages > 1 ? `
        <div class="pagination-controls">
          <div class="breadcrumbs">
            <span>${seriesTitle}</span>
            <span>•</span>
            <span>Temporada ${seasonNumberFromEpisode}</span>
            <span>•</span>
            <span class="current">Episodios ${startIndex + 1}-${endIndex} de ${totalEpisodes}</span>
          </div>
          
          <div class="pagination-nav">
            ${page > 1 ? `
              <a href="/list?downloads=${encodeURIComponent(JSON.stringify(downloads))}&page=1&pageSize=${pageSize}" class="page-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.41 7.41L17 6l-6 6 6 6 1.41-1.41L13.83 12l4.58-4.59z"/>
                  <path d="M12.41 7.41L11 6l-6 6 6 6 1.41-1.41L7.83 12l4.58-4.59z"/>
                </svg>
                Primera
              </a>
              <a href="/list?downloads=${encodeURIComponent(JSON.stringify(downloads))}&page=${page - 1}&pageSize=${pageSize}" class="page-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
                </svg>
                Anterior
              </a>
            ` : ''}
            
            ${(() => {
              let pageNumbers = '';
              const startPage = Math.max(1, page - 2);
              const endPage = Math.min(totalPages, page + 2);
              
              for (let i = startPage; i <= endPage; i++) {
                const isCurrentPage = i === page;
                pageNumbers += `
                  <a href="/list?downloads=${encodeURIComponent(JSON.stringify(downloads))}&page=${i}&pageSize=${pageSize}" 
                     class="page-btn ${isCurrentPage ? 'current' : ''}">${i}</a>
                `;
              }
              return pageNumbers;
            })()}
            
            ${page < totalPages ? `
              <a href="/list?downloads=${encodeURIComponent(JSON.stringify(downloads))}&page=${page + 1}&pageSize=${pageSize}" class="page-btn">
                Siguiente
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
                </svg>
              </a>
              <a href="/list?downloads=${encodeURIComponent(JSON.stringify(downloads))}&page=${totalPages}&pageSize=${pageSize}" class="page-btn">
                Última
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5.59 7.41L7 6l6 6-6 6-1.41-1.41L10.17 12L5.59 7.41z"/>
                  <path d="M11.59 7.41L13 6l6 6-6 6-1.41-1.41L16.17 12L11.59 7.41z"/>
                </svg>
              </a>
            ` : ''}
          </div>
          
          <div class="episode-jump">
            <span>Ir al episodio:</span>
            <input type="number" id="episode-input" min="1" max="${totalEpisodes}" placeholder="Nº">
            <button onclick="jumpToEpisode()">Ir</button>
          </div>
        </div>
        ` : ''}
      </div>
    </body>
    </html>
  `);
});

// Ruta para películas individuales
app.get('/movie', async (req, res) => {
  const {
    accessToken = '',
    partKey: encodedPartKey = '',
    baseURI = '',
    fileSize = '',
    fileName = '',
    downloadURL = '',
    title = '',
    posterUrl = '',
    tmdbId = ''
  } = req.query;

  const partKey = decodeURIComponent(encodedPartKey);
  
  // Obtener datos completos de TMDB si tenemos el ID
  let movieData = null;
  if (tmdbId) {
    movieData = await fetchTMDBMovieData(tmdbId);
  }
  
  // Usar datos de TMDB o fallback a los datos de Plex
  const movieTitle = movieData ? movieData.title : title;
  const moviePoster = movieData && movieData.posterPath ? movieData.posterPath : posterUrl;
  const movieBackdrop = movieData && movieData.backdropPath ? movieData.backdropPath : posterUrl;
  
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>${movieTitle} - Descarga</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="icon" type="image/x-icon" href="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/favicon.ico">
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
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
        }
        
        .modal-content {
          background: #282828;
          border-radius: 16px;
          width: 100%;
          max-width: 1200px;
          max-height: 90vh;
          overflow-y: auto;
          position: relative;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
        }
        
        .modal-content::-webkit-scrollbar {
          width: 8px;
        }
        
        .modal-content::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .modal-content::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.2);
          border-radius: 4px;
        }
        
        .modal-backdrop-header {
          position: relative;
          background-size: cover;
          background-position: center top;
          background-repeat: no-repeat;
          background-image: url('${movieBackdrop}');
          min-height: 233px;
          display: flex;
          align-items: flex-end;
          padding: 2.5rem 3.5rem 1.5rem 3.5rem;
          border-radius: 12px 12px 0 0;
        }
        
        .modal-backdrop-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            to bottom,
            rgba(0, 0, 0, 0.3) 0%,
            rgba(0, 0, 0, 0.6) 50%,
            rgba(40, 40, 40, 0.95) 100%
          );
          border-radius: 12px 12px 0 0;
          z-index: 1;
        }
        
        .modal-header-content {
          position: relative;
          z-index: 2;
          width: 100%;
        }
        
        .modal-title {
          font-size: 2.8rem;
          font-weight: 700;
          margin: 0 0 0.5rem 0;
          text-shadow: 2px 2px 6px rgba(0, 0, 0, 0.8);
          line-height: 1.1;
          color: white;
        }
        
        .modal-tagline {
          color: rgba(255, 255, 255, 0.9);
          font-size: 1.1rem;
          font-style: italic;
          text-shadow: 1px 1px 4px rgba(0, 0, 0, 0.8);
          margin-bottom: 1rem;
        }
        
        .modal-badges-container {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
          flex-wrap: wrap;
        }
        
        .modal-badges-row {
          display: flex;
          gap: 1rem;
          align-items: center;
          flex-wrap: wrap;
        }
        
        .modal-icons-row {
          display: flex;
          gap: 0.75rem;
          align-items: center;
          margin-left: auto;
        }
        
        .year-badge,
        .runtime-badge,
        .filesize-badge {
          background: #e5a00d;
          color: #000;
          padding: 0.4rem 0.8rem;
          border-radius: 20px;
          font-weight: 600;
          font-size: 0.9rem;
        }
        
        .rating-badge {
          background: rgba(249, 168, 37, 0.2);
          border: 2px solid #f9a825;
          padding: 0.3rem 0.8rem;
          border-radius: 20px;
          display: flex;
          align-items: center;
          gap: 0.4rem;
          color: #f9a825;
          font-weight: 600;
        }
        
        .genres-list {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        
        .genre-tag {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          padding: 0.3rem 0.8rem;
          border-radius: 15px;
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.9);
          transition: all 0.3s ease;
        }
        
        .badge-icon-link {
          display: inline-flex;
          align-items: center;
          transition: transform 0.2s ease;
        }
        
        .badge-icon-link:hover {
          transform: scale(1.1);
        }
        
        .badge-icon {
          height: 32px;
          width: 32px;
          object-fit: contain;
        }
        
        .modal-hero {
          padding: 1rem 3.5rem;
          display: flex;
          gap: 2rem;
        }
        
        .modal-poster-container {
          flex-shrink: 0;
        }
        
        .modal-poster-hero {
          width: 300px;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
        }
        
        .modal-poster-hero img {
          width: 100%;
          height: auto;
          display: block;
          object-fit: cover;
        }
        
        .download-button {
          width: 100%;
          margin-top: 1rem;
          background: #e5a00d;
          color: #1e1e27;
          border: none;
          border-radius: 8px;
          padding: 1rem;
          font-weight: bold;
          font-size: 1.1rem;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }
        
        .download-button:hover {
          background: #e0b316;
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(229, 160, 13, 0.4);
        }
        
        .modal-main-info {
          flex: 1;
        }
        
        .modal-details-table {
          display: grid;
          grid-template-columns: 1fr;
          justify-content: space-between;
          gap: 0;
          margin-bottom: 1rem;
          background: rgba(255, 255, 255, 0.07);
          padding: 0.5rem;
          border-radius: 8px;
        }
        
        .detail-item {
          display: flex;
          justify-content: space-between;
          padding: 0.5rem 0;
          border-bottom: 1px solid rgba(229, 160, 13, 0.08);
        }
        
        .detail-item:last-child {
          border-bottom: none;
        }
        
        .detail-item strong {
          color: #e5e5e5;
          font-weight: 600;
        }
        
        .detail-item span {
          color: #e5e5e5;
          text-align: right;
        }
        
        .synopsis-container {
          position: relative;
        }
        
        .modal-synopsis {
          line-height: 1.7;
          font-size: 1.08rem;
          text-align: justify;
          margin-bottom: 0;
          color: #cccccc;
          max-height: 8.5em;
          overflow: hidden;
          transition: max-height 0.3s ease;
          position: relative;
          padding-right: 0;
        }
        
        .modal-synopsis.expanded {
          max-height: none;
        }
        
        .modal-synopsis::after {
          content: '...';
          position: absolute;
          bottom: 0;
          right: 1.2rem;
          background: linear-gradient(to right, transparent 0%, #282828 25%, #282828 100%);
          color: #cccccc;
          width: 2.2rem;
          text-align: right;
        }
        
        .modal-synopsis.expanded::after {
          content: '';
          display: none;
        }
        
        .synopsis-toggle {
          position: absolute;
          bottom: 0;
          right: 0;
          background: #282828;
          border: none;
          color: #e5a00d;
          font-size: 1.3rem;
          font-weight: bold;
          cursor: pointer;
          padding: 0 0.25rem;
          transition: transform 0.2s ease;
          line-height: 1.7;
          z-index: 2;
        }
        
        .synopsis-toggle:hover {
          transform: scale(1.15);
          color: #f0b825;
        }
        
        .external-links a {
          transition: transform 0.3s ease, opacity 0.3s ease;
          display: block;
        }
        
        .external-links a:hover {
          transform: scale(1.1);
          opacity: 0.8;
        }
        
        .site-logo {
          height: 40px;
          width: auto;
          object-fit: contain;
        }
        
        .file-info {
          background: rgba(0, 0, 0, 0.3);
          padding: 0.5rem 3.5rem;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .technical-details {
          max-width: 800px;
          margin: 0 auto;
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
          text-align: center;
          display: block;
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
          color: #888;
          font-weight: 500;
          width: 35%;
        }
        
        .info-table td.value {
          color: #bbb;
          font-family: 'Courier New', monospace;
          font-size: 0.8rem;
          word-break: break-all;
        }
        
        @media (max-width: 768px) {
          .modal-hero {
            flex-direction: column;
            padding: 1.5rem;
          }
          
          .modal-poster-hero {
            width: 100%;
            max-width: 300px;
            margin: 0 auto;
          }
          
          .modal-backdrop-header {
            padding: 2rem 1.5rem 1rem;
          }
          
          .modal-title {
            font-size: 2rem;
          }
          
          .modal-badges-container {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.75rem;
          }
          
          .modal-icons-row {
            margin-left: 0;
          }
          
          .file-info {
            padding: 1rem 1.5rem;
          }
          
          .detail-item {
            flex-direction: column;
            gap: 0.3rem;
          }
          
          .detail-item strong {
            min-width: auto;
          }
        }
      </style>
    </head>
    <body>
      <div class="modal-content">
        <!-- Header con backdrop -->
        <div class="modal-backdrop-header">
          <div class="modal-backdrop-overlay"></div>
          <div class="modal-header-content">
            <h1 class="modal-title">${movieTitle}</h1>
            ${movieData && movieData.tagline ? `<div class="modal-tagline">${movieData.tagline}</div>` : ''}
            <div class="modal-badges-container">
              <div class="modal-badges-row">
                ${fileSize ? `<span class="filesize-badge">${fileSize}</span>` : ''}
                ${movieData && movieData.year ? `<span class="year-badge">${movieData.year}</span>` : ''}
                ${movieData && movieData.runtime ? `<span class="runtime-badge">${movieData.runtime}</span>` : ''}
                ${movieData && movieData.rating !== 'N/A' ? `
                  <span class="rating-badge">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                    </svg>
                    ${movieData.rating}
                  </span>
                ` : ''}
                ${movieData && movieData.genres && movieData.genres.length > 0 ? `
                  <div class="genres-list">
                    ${movieData.genres.map(genre => `<span class="genre-tag">${genre}</span>`).join('')}
                  </div>
                ` : ''}
              </div>
              <div class="modal-icons-row">
                ${tmdbId ? `
                  <a href="https://www.themoviedb.org/movie/${tmdbId}" target="_blank" rel="noopener noreferrer" title="Ver en TMDB" class="badge-icon-link">
                    <img src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/TMDB.png" alt="TMDB" class="badge-icon">
                  </a>
                ` : ''}
                ${movieData && movieData.imdbId ? `
                  <a href="https://www.imdb.com/title/${movieData.imdbId}" target="_blank" rel="noopener noreferrer" title="Ver en IMDb" class="badge-icon-link">
                    <img src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/IMDB.png" alt="IMDb" class="badge-icon">
                  </a>
                ` : ''}
                ${movieData && movieData.trailerKey ? `
                  <a href="https://www.youtube.com/watch?v=${movieData.trailerKey}" target="_blank" rel="noopener noreferrer" title="Ver trailer" class="badge-icon-link">
                    <img src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/youtube.png" alt="YouTube" class="badge-icon">
                  </a>
                ` : ''}
              </div>
            </div>
          </div>
        </div>
        
        <!-- Hero con poster e info -->
        <div class="modal-hero">
          <div class="modal-poster-container">
            <div class="modal-poster-hero">
              <img src="${moviePoster}" alt="${movieTitle}">
            </div>
            <button class="download-button" onclick="window.location.href='${downloadURL}'">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z"/>
              </svg>
              Descargar Película
            </button>
          </div>
          
          <div class="modal-main-info">
            ${movieData ? `
              <div class="modal-details-table">
                <div class="detail-item"><strong>Votos:</strong> <span>${movieData.voteCount}</span></div>
                <div class="detail-item"><strong>Título original:</strong> <span>${movieData.originalTitle}</span></div>
                <div class="detail-item"><strong>Fecha de estreno:</strong> <span>${movieData.releaseDate}</span></div>
                <div class="detail-item"><strong>Países:</strong> <span>${movieData.countries}</span></div>
                <div class="detail-item"><strong>Idioma original:</strong> <span>${movieData.originalLanguage}</span></div>
                <div class="detail-item"><strong>Director:</strong> <span>${movieData.director}</span></div>
                <div class="detail-item"><strong>Reparto:</strong> <span>${movieData.cast}</span></div>
                <div class="detail-item"><strong>Presupuesto:</strong> <span>${movieData.budget}</span></div>
                <div class="detail-item"><strong>Recaudación:</strong> <span>${movieData.revenue}</span></div>
              </div>
              <div class="synopsis-container">
                <div class="modal-synopsis" id="synopsis-text">
                  ${movieData.overview}
                </div>
                <button class="synopsis-toggle" id="synopsis-toggle" onclick="toggleSynopsis()">+</button>
              </div>
            ` : `
              <div class="synopsis-container">
                <div class="modal-synopsis">
                  Película lista para descargar. Haz clic en el botón de descarga para comenzar.
                </div>
              </div>
            `}
          </div>
        </div>
        
        <!-- Info del archivo -->
        <div class="file-info">
          <div class="technical-details">
            <button class="technical-toggle" id="technical-toggle" onclick="toggleTechnical()">
              ▶ Mostrar detalles técnicos
            </button>
            <div class="technical-content" id="technical-content">
              <table class="info-table">
                <tr>
                  <td class="label">Access Token</td>
                  <td class="value">${accessToken ? accessToken.substring(0, 20) + '...' : 'N/A'}</td>
                </tr>
                <tr>
                  <td class="label">Part Key</td>
                  <td class="value">${encodedPartKey}</td>
                </tr>
                <tr>
                  <td class="label">Base URL</td>
                  <td class="value">${baseURI}</td>
                </tr>
                <tr>
                  <td class="label">Nombre del archivo</td>
                  <td class="value">${fileName}</td>
                </tr>
                <tr>
                  <td class="label">Tamaño</td>
                  <td class="value">${fileSize || 'Desconocido'}</td>
                </tr>
              </table>
            </div>
          </div>
        </div>
      </div>
      
      <script>
        function toggleTechnical() {
          const content = document.getElementById('technical-content');
          const button = document.getElementById('technical-toggle');
          content.classList.toggle('open');
          button.textContent = content.classList.contains('open') 
            ? '▼ Ocultar detalles técnicos' 
            : '▶ Mostrar detalles técnicos';
        }
        
        function toggleSynopsis() {
          const synopsis = document.getElementById('synopsis-text');
          const button = document.getElementById('synopsis-toggle');
          synopsis.classList.toggle('expanded');
          button.textContent = synopsis.classList.contains('expanded') ? '−' : '+';
        }
        
        // Auto-descargar al cargar la página
        window.onload = function() {
          setTimeout(function() {
            window.location.href = '${downloadURL}';
          }, 1000);
        };
      </script>
    </body>
    </html>
  `);
});

// Ruta para series
app.get('/series', async (req, res) => {
  const {
    accessToken = '',
    baseURI = '',
    seriesId = '',
    title: seriesTitle = '',
    posterUrl = '',
    tmdbId = '',
    totalSize = '',
    seasons: seasonsParam = '[]'
  } = req.query;
  
  // Parsear temporadas
  let seasons = [];
  try {
    seasons = JSON.parse(seasonsParam);
  } catch (e) {
    console.error('Error parsing seasons:', e);
  }
  
  // Obtener datos de TMDB si está disponible
  let seriesData = null;
  if (tmdbId) {
    seriesData = await fetchTMDBSeriesData(tmdbId);
  }
  
  // Usar poster y backdrop de TMDB si están disponibles
  const seriesPoster = (seriesData && seriesData.posterPath) || posterUrl || '';
  const seriesBackdrop = (seriesData && seriesData.backdropPath) || '';
  
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${seriesTitle} - PlexDL</title>
      <link rel="icon" type="image/x-icon" href="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/favicon.ico">
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
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
        }
        
        .modal-content {
          background: #282828;
          border-radius: 16px;
          width: 100%;
          max-width: 1200px;
          max-height: 90vh;
          overflow-y: auto;
          position: relative;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
        }
        
        .modal-content::-webkit-scrollbar {
          width: 8px;
        }
        
        .modal-content::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .modal-content::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.2);
          border-radius: 4px;
        }
        
        .modal-backdrop-header {
          position: relative;
          background-size: cover;
          background-position: center top;
          background-repeat: no-repeat;
          background-image: url('${seriesBackdrop}');
          min-height: 250px;
          display: flex;
          align-items: flex-end;
          padding: 2.5rem 3.5rem 1.5rem 3.5rem;
          border-radius: 12px 12px 0 0;
        }
        
        .modal-backdrop-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            to bottom,
            rgba(40, 40, 40, 0.3) 0%,
            rgba(40, 40, 40, 0.7) 50%,
            #282828 100%
          );
          border-radius: 12px 12px 0 0;
        }
        
        .modal-header-content {
          position: relative;
          z-index: 1;
          width: 100%;
        }
        
        .modal-title {
          font-size: 3rem;
          font-weight: 700;
          margin-bottom: 0.5rem;
          text-shadow: 2px 2px 8px rgba(0, 0, 0, 0.9);
          line-height: 1.1;
          color: white;
        }
        
        .modal-tagline {
          color: rgba(255, 255, 255, 0.9);
          font-size: 1.1rem;
          font-style: italic;
          text-shadow: 1px 1px 4px rgba(0, 0, 0, 0.8);
          margin-bottom: 1rem;
        }
        
        .modal-badges-container {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
          flex-wrap: wrap;
        }
        
        .modal-badges-row {
          display: flex;
          gap: 1rem;
          align-items: center;
          flex-wrap: wrap;
        }
        
        .modal-icons-row {
          display: flex;
          gap: 0.75rem;
          align-items: center;
          margin-left: auto;
        }
        
        .filesize-badge {
          background: #e5a00d;
          color: #000;
          padding: 0.4rem 0.8rem;
          border-radius: 20px;
          font-weight: 600;
          font-size: 0.9rem;
        }

        .year-badge,
        .status-badge,
        .seasons-badge {
          background: #e5a00d;
          color: #000;
          padding: 0.4rem 0.8rem;
          border-radius: 20px;
          font-weight: 600;
          font-size: 0.9rem;
        }
        
        .rating-badge {
          background: rgba(249, 168, 37, 0.2);
          border: 2px solid #f9a825;
          padding: 0.3rem 0.8rem;
          border-radius: 20px;
          display: flex;
          align-items: center;
          gap: 0.4rem;
          color: #f9a825;
          font-weight: 600;
        }
        
        .genres-list {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        
        .genre-tag {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          padding: 0.3rem 0.8rem;
          border-radius: 15px;
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.9);
          transition: all 0.3s ease;
        }
        
        .badge-icon-link {
          display: inline-flex;
          align-items: center;
          transition: transform 0.2s ease;
        }
        
        .badge-icon-link:hover {
          transform: scale(1.1);
        }
        
        .badge-icon {
          height: 32px;
          width: 32px;
          object-fit: contain;
        }
        
        .modal-hero {
          padding: 2rem 3.5rem;
          display: flex;
          gap: 2rem;
        }
        
        .modal-poster-container {
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        
        .modal-poster-hero {
          width: 280px;
          position: relative;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        }
        
        .modal-poster-hero img {
          width: 100%;
          height: auto;
          display: block;
        }
        
        .modal-main-info {
          flex: 1;
        }
        
        .modal-details-table {
          display: grid;
          grid-template-columns: 1fr;
          justify-content: space-between;
          gap: 0;
          margin-bottom: 1rem;
          background: rgba(255, 255, 255, 0.07);
          padding: 0.5rem;
          border-radius: 8px;
        }
        
        .detail-item {
          display: flex;
          justify-content: space-between;
          padding: 0.5rem 0;
          border-bottom: 1px solid rgba(229, 160, 13, 0.08);
        }
        
        .detail-item:last-child {
          border-bottom: none;
        }
        
        .detail-item strong {
          color: #e5e5e5;
          font-weight: 600;
        }
        
        .detail-item span {
          color: #e5e5e5;
          text-align: right;
        }
        
        .synopsis-container {
          position: relative;
        }
        
        .modal-synopsis {
          line-height: 1.7;
          font-size: 1.08rem;
          text-align: justify;
          margin-bottom: 0;
          color: #cccccc;
          max-height: 6.8em;
          overflow: hidden;
          transition: max-height 0.3s ease;
          position: relative;
          padding-right: 0;
        }
        
        .modal-synopsis.expanded {
          max-height: none;
        }
        
        .modal-synopsis::after {
          content: '...';
          position: absolute;
          bottom: 0;
          right: 1.2rem;
          background: linear-gradient(to right, transparent 0%, #282828 25%, #282828 100%);
          color: #cccccc;
          width: 2,2rem;
          text-align: right;
        }
        
        .modal-synopsis.expanded::after {
          content: '';
          display: none;
        }
        
        .synopsis-toggle {
          position: absolute;
          bottom: 0;
          right: 0;
          background: #282828;
          border: none;
          color: #e5a00d;
          font-size: 1.3rem;
          font-weight: bold;
          cursor: pointer;
          padding: 0 0.25rem;
          transition: transform 0.2s ease;
          line-height: 1.7;
          z-index: 2;
        }
        
        .synopsis-toggle:hover {
          transform: scale(1.15);
          color: #f0b825;
        }
        
        .seasons-section {
          padding: 2rem 3.5rem;
          background: rgba(0, 0, 0, 0.2);
        }
        
        .seasons-title {
          font-size: 1.5rem;
          font-weight: 700;
          margin-bottom: 1.5rem;
          color: #e5a00d;
        }
        
        .seasons-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 1.5rem;
        }
        
        .season-card {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          overflow: hidden;
          cursor: pointer;
          transition: all 0.3s ease;
          border: 2px solid transparent;
        }
        
        .season-card:hover {
          transform: translateY(-4px);
          border-color: #e5a00d;
          box-shadow: 0 8px 24px rgba(229, 160, 13, 0.3);
        }
        
        .season-poster {
          width: 100%;
          aspect-ratio: 2/3;
          object-fit: cover;
          background: rgba(255, 255, 255, 0.1);
        }
        
        .season-info {
          padding: 1rem;
        }
        
        .season-name {
          font-size: 1rem;
          font-weight: 600;
          margin-bottom: 0.5rem;
          color: #fff;
        }
        
        .season-episodes {
          font-size: 0.85rem;
          color: #999;
        }
        
        @media (max-width: 768px) {
          .modal-hero {
            flex-direction: column;
            padding: 1.5rem;
          }
          
          .modal-poster-hero {
            width: 100%;
            max-width: 300px;
            margin: 0 auto;
          }
          
          .modal-backdrop-header {
            padding: 2rem 1.5rem 1rem;
          }
          
          .modal-title {
            font-size: 2rem;
          }
          
          .modal-badges-container {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.75rem;
          }
          
          .modal-icons-row {
            margin-left: 0;
          }
          
          .seasons-section {
            padding: 1.5rem;
          }
          
          .seasons-grid {
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
            gap: 1rem;
          }
          
          .detail-item {
            flex-direction: column;
            gap: 0.3rem;
          }
          
          .detail-item strong {
            min-width: auto;
          }
        }
      </style>
    </head>
    <body>
      <div class="modal-content">
        <!-- Header con backdrop -->
        <div class="modal-backdrop-header">
          <div class="modal-backdrop-overlay"></div>
          <div class="modal-header-content">
            <h1 class="modal-title">${seriesTitle}</h1>
            ${seriesData && seriesData.tagline ? `<div class="modal-tagline">${seriesData.tagline}</div>` : ''}
            <div class="modal-badges-container">
              <div class="modal-badges-row">
                ${totalSize ? `<span class="filesize-badge">${totalSize}</span>` : ''}
                ${seriesData && seriesData.year ? `<span class="year-badge">${seriesData.year}</span>` : ''}
                ${seriesData && seriesData.status ? `<span class="status-badge">${seriesData.status}</span>` : ''}
                ${seriesData && seriesData.rating !== 'N/A' ? `
                  <span class="rating-badge">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                    </svg>
                    ${seriesData.rating}
                  </span>
                ` : ''}
                ${seriesData && seriesData.genres && seriesData.genres.length > 0 ? `
                  <div class="genres-list">
                    ${seriesData.genres.map(genre => `<span class="genre-tag">${genre}</span>`).join('')}
                  </div>
                ` : ''}
              </div>
              <div class="modal-icons-row">
                ${tmdbId ? `
                  <a href="https://www.themoviedb.org/tv/${tmdbId}" target="_blank" rel="noopener noreferrer" title="Ver en TMDB" class="badge-icon-link">
                    <img src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/TMDB.png" alt="TMDB" class="badge-icon">
                  </a>
                ` : ''}
                ${seriesData && seriesData.imdbId ? `
                  <a href="https://www.imdb.com/title/${seriesData.imdbId}" target="_blank" rel="noopener noreferrer" title="Ver en IMDb" class="badge-icon-link">
                    <img src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/IMDB.png" alt="IMDb" class="badge-icon">
                  </a>
                ` : ''}
                ${seriesData && seriesData.trailerKey ? `
                  <a href="https://www.youtube.com/watch?v=${seriesData.trailerKey}" target="_blank" rel="noopener noreferrer" title="Ver trailer" class="badge-icon-link">
                    <img src="https://raw.githubusercontent.com/sergioat93/plex-redirect/main/youtube.png" alt="YouTube" class="badge-icon">
                  </a>
                ` : ''}
              </div>
            </div>
          </div>
        </div>
        
        <!-- Hero con poster e info -->
        <div class="modal-hero">
          <div class="modal-poster-container">
            <div class="modal-poster-hero">
              <img src="${seriesPoster}" alt="${seriesTitle}">
            </div>
          </div>
          
          <div class="modal-main-info">
            ${seriesData ? `
              <div class="modal-details-table">
                <div class="detail-item"><strong>Título original:</strong> <span>${seriesData.originalTitle}</span></div>
                <div class="detail-item"><strong>Primera emisión:</strong> <span>${seriesData.firstAirDate}</span></div>
                <div class="detail-item"><strong>Última emisión:</strong> <span>${seriesData.lastAirDate}</span></div>
                <div class="detail-item"><strong>Plataforma:</strong> <span>${seriesData.networks}</span></div>
                <div class="detail-item"><strong>Creadores:</strong> <span>${seriesData.creators}</span></div>
                <div class="detail-item"><strong>Reparto:</strong> <span>${seriesData.cast}</span></div>
                <div class="detail-item"><strong>Número de temporadas:</strong> <span>${seriesData.numberOfSeasons}</span></div>
                <div class="detail-item"><strong>Número de episodios:</strong> <span>${seriesData.numberOfEpisodes}</span></div>
              </div>
              <div class="synopsis-container">
                <div class="modal-synopsis" id="synopsis-text">
                  ${seriesData.overview}
                </div>
                <button class="synopsis-toggle" id="synopsis-toggle" onclick="toggleSynopsis()">+</button>
              </div>
            ` : `
              <div class="synopsis-container">
                <div class="modal-synopsis">
                  Serie lista para ver. Selecciona una temporada abajo.
                </div>
              </div>
            `}
          </div>
        </div>
        
        <!-- Sección de temporadas -->
        <div class="seasons-section">
          <h2 class="seasons-title">Temporadas</h2>
          <div class="seasons-grid">
            ${seasons.map(season => `
              <div class="season-card" onclick="goToSeason('${season.ratingKey}', '${accessToken}', '${baseURI}', ${season.index}, '${seriesTitle}', '${tmdbId}')">
                <img src="${season.poster}" alt="${season.title}" class="season-poster" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27200%27 height=%27300%27%3E%3Crect fill=%27%23333%27 width=%27200%27 height=%27300%27/%3E%3Ctext fill=%27%23999%27 x=%2750%25%27 y=%2750%25%27 text-anchor=%27middle%27 dy=%27.3em%27%3ENo image%3C/text%3E%3C/svg%3E'">
                <div class="season-info">
                  <div class="season-name">${season.title}</div>
                  <div class="season-episodes">${season.episodeCount} episodios</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      
      <script>
        function toggleSynopsis() {
          const synopsis = document.getElementById('synopsis-text');
          const button = document.getElementById('synopsis-toggle');
          if (synopsis && button) {
            synopsis.classList.toggle('expanded');
            button.textContent = synopsis.classList.contains('expanded') ? '−' : '+';
          }
        }
        
        function goToSeason(seasonRatingKey, accessToken, baseURI, seasonNumber, seriesTitle, tmdbId) {
          // Redirigir a la página /list con los datos de la temporada
          const params = new URLSearchParams();
          params.set('accessToken', accessToken);
          params.set('baseURI', baseURI);
          params.set('seasonRatingKey', seasonRatingKey);
          params.set('seasonNumber', seasonNumber);
          params.set('seriesTitle', seriesTitle);
          if (tmdbId) params.set('tmdbId', tmdbId);
          
          window.location.href = '/list?' + params.toString();
        }
      </script>
    </body>
    </html>
  `);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
});
