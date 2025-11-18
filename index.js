const express = require('express');
const https = require('https');
const app = express();

// ⚠️ IMPORTANTE: Reemplaza esto con tu propia API Key de TMDB
// Obtén una gratis en: https://www.themoviedb.org/settings/api
const TMDB_API_KEY = '5aaa0a6844d70ade130e868275ee2cc2';

// Función helper para hacer requests HTTPS
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
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  
  if (!downloadsParam) {
    return res.status(400).send('No downloads provided');
  }
  
  let downloads = [];
  try {
    downloads = JSON.parse(downloadsParam);
  } catch (e) {
    return res.status(400).send('Invalid downloads format');
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
  
  // Obtener información de la serie/temporada
  const firstEpisode = episodes[0];
  let seriesTitle = seasonInfo && seasonInfo.seriesTitle ? seasonInfo.seriesTitle : (seasonInfo ? seasonInfo.seasonTitle : (firstEpisode.title || 'Contenido'));
  const seasonNumber = firstEpisode.seasonNumber || '';
  let seasonSummary = seasonInfo ? seasonInfo.seasonSummary : '';
  let seasonYear = seasonInfo ? seasonInfo.seasonYear : '';
  let seasonPoster = seasonInfo ? seasonInfo.seasonPoster : (firstEpisode.posterUrl || '');
  
  // Intentar mejorar datos con TMDB si disponible
  if (seasonInfo && seasonInfo.tmdbId) {
    try {
      // Obtener datos generales de la serie
      const seriesData = await fetchTMDBData(seasonInfo.tmdbId, 'tv');
      
      // Obtener datos específicos de la temporada
      const seasonData = await fetchTMDBSeasonData(seasonInfo.tmdbId, seasonNumber);
      
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
      
      if (seriesData && seriesData.releaseYear && !seasonYear) {
        seasonYear = seriesData.releaseYear.toString();
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
        
        let isDownloading = false;
        let downloadIndex = 0;
        
        function downloadEpisode(globalIndex, fromSequential = false) {
          const download = allEpisodes[globalIndex];
          
          // Crear iframe oculto para descarga directa
          const iframe = document.createElement('iframe');
          iframe.style.display = 'none';
          
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
          params.set('autoDownload', 'true');
          
          iframe.src = 'https://plex-redirect.onrender.com/?' + params.toString();
          document.body.appendChild(iframe);
          
          // Remover iframe después de un tiempo
          setTimeout(() => {
            document.body.removeChild(iframe);
            if (fromSequential) {
              downloadIndex++;
              if (downloadIndex < allEpisodes.length) {
                updateProgress();
                setTimeout(() => downloadEpisode(downloadIndex, true), 3000);
              } else {
                finishSequentialDownload();
              }
            }
          }, 2000);
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
            
            setTimeout(downloadNextPageEpisode, 3000);
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
        
        function toggleDescription() {
          const textEl = document.getElementById('description-text');
          const btnEl = document.getElementById('expand-description-btn');
          const seasonSummaryFull = \`${seasonSummary}\`;
          
          if (btnEl && btnEl.classList.contains('expanded')) {
            textEl.textContent = seasonSummaryFull.length > 200 ? seasonSummaryFull.substring(0, 200) + '...' : seasonSummaryFull;
            btnEl.querySelector('span').textContent = 'Más';
            btnEl.classList.remove('expanded');
          } else if (btnEl) {
            textEl.textContent = seasonSummaryFull;
            btnEl.querySelector('span').textContent = 'Menos';
            btnEl.classList.add('expanded');
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
          ${seasonPoster ? `<img class="series-poster" src="${seasonPoster}" alt="${seriesTitle}">` : ''}
          <div class="series-info">
            <h1>${seriesTitle}</h1>
            <div class="series-meta">
              ${seasonNumber ? `<div class="meta-badge">Temporada ${seasonNumber}</div>` : ''}
              <div class="meta-badge">${totalEpisodes} ${totalEpisodes === 1 ? 'Episodio' : 'Episodios'}</div>
              ${seasonYear ? `<div class="meta-badge">${seasonYear}</div>` : ''}
              ${totalPages > 1 ? `<div class="meta-badge">Página ${page} de ${totalPages}</div>` : ''}
            </div>
            ${seasonSummary ? `
              <div class="series-description" id="series-description">
                <div class="description-text" id="description-text">${seasonSummary.length > 200 ? seasonSummary.substring(0, 200) + '...' : seasonSummary}</div>
                ${seasonSummary.length > 200 ? `
                  <button class="expand-description-btn" id="expand-description-btn" onclick="toggleDescription()">
                    <span>Más</span>
                    <svg width="16" height="16" viewBox="0 0 48 48" fill="currentColor">
                      <path d="M24.1213 33.2213L7 16.1L9.1 14L24.1213 29.0213L39.1426 14L41.2426 16.1L24.1213 33.2213Z"/>
                    </svg>
                  </button>
                ` : ''}
              </div>
            ` : ''}
            
            <div class="action-buttons">
              <button class="download-season-btn" id="download-season-btn" onclick="downloadSeasonSequential()">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z"/>
                </svg>
                Descargar Temporada Completa
              </button>
              
              ${currentPageEpisodes.length > 1 ? `
                <button class="download-page-btn" id="download-page-btn" onclick="downloadCurrentPage()">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z"/>
                  </svg>
                  Descargar Esta Página (${currentPageEpisodes.length} episodios)
                </button>
              ` : ''}
            </div>
            
            <div class="progress-indicator" id="progress-indicator">
              <div class="progress-text" id="progress-text"></div>
              <div class="progress-bar">
                <div class="progress-fill" id="progress-fill"></div>
              </div>
            </div>
          </div>
        </div>
        
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
                  ${download.fileSize ? `<span>📦 ${download.fileSize}</span>` : ''}
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
            <span>Temporada ${seasonNumber}</span>
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
          min-height: 300px;
          display: flex;
          align-items: flex-end;
          padding: 3.5rem 3.5rem 1.5rem 3.5rem;
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
        
        .modal-badges-row {
          display: flex;
          gap: 1rem;
          align-items: center;
          flex-wrap: wrap;
        }
        
        .year-badge,
        .runtime-badge {
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
        
        .modal-hero {
          padding: 2rem 3.5rem;
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
          gap: 0.8rem;
          margin-bottom: 1.5rem;
          background: rgba(0, 0, 0, 0.3);
          padding: 1.5rem;
          border-radius: 8px;
        }
        
        .detail-item {
          display: flex;
          padding: 0.5rem 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .detail-item:last-child {
          border-bottom: none;
        }
        
        .detail-item strong {
          min-width: 180px;
          color: #e5a00d;
          font-weight: 600;
        }
        
        .detail-item span {
          color: #e5e5e5;
          flex: 1;
        }
        
        .modal-synopsis {
          background: rgba(0, 0, 0, 0.2);
          padding: 1.5rem;
          border-radius: 8px;
          line-height: 1.6;
          color: #cccccc;
        }
        
        .modal-links-row {
          padding: 1.5rem 3.5rem 2rem;
          display: flex;
          justify-content: center;
          gap: 1.5rem;
        }
        
        .external-links {
          display: flex;
          gap: 1.5rem;
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
          padding: 1rem 3.5rem;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 1rem;
        }
        
        .file-name {
          font-family: 'Courier New', monospace;
          color: #999;
          font-size: 0.9rem;
          word-break: break-all;
        }
        
        .file-size {
          color: #e5a00d;
          font-weight: 600;
          font-size: 1rem;
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
          
          .modal-links-row {
            padding: 1.5rem;
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
            <div class="modal-badges-row">
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
              <div class="modal-synopsis">
                <p>${movieData.overview}</p>
              </div>
            ` : `
              <div class="modal-synopsis">
                <p>Película lista para descargar. Haz clic en el botón de descarga para comenzar.</p>
              </div>
            `}
          </div>
        </div>
        
        <!-- Enlaces externos -->
        <div class="modal-links-row">
          <div class="external-links">
            ${tmdbId ? `
              <a href="https://www.themoviedb.org/movie/${tmdbId}" target="_blank" rel="noopener noreferrer" title="Ver en TMDB">
                <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 273.42 35.52'%3E%3Cdefs%3E%3Cstyle%3E.cls-1%7Bfill:%2301d277;%7D%3C/style%3E%3C/defs%3E%3Cg id='Layer_2' data-name='Layer 2'%3E%3Cg id='Layer_1-2' data-name='Layer 1'%3E%3Cpath class='cls-1' d='M124.98,8.31h-10V34.85h5.31V26h4.69c5,0,8-2.87,8-8.12v-.42C133,12.21,130.21,8.31,124.98,8.31ZM127.71,18c0,2.18-1.24,3.5-3.5,3.5h-4V13h4c2.26,0,3.5,1.32,3.5,3.5Z'/%3E%3Cpath class='cls-1' d='M139.61,8.31V34.85h5.31V8.31Z'/%3E%3Cpath class='cls-1' d='M157.7,8.31h-10V34.85h5.31V26h4.69c5,0,8-2.87,8-8.12v-.42C165.69,12.21,162.93,8.31,157.7,8.31Zm2.73,9.7c0,2.18-1.24,3.5-3.5,3.5h-4V13h4c2.26,0,3.5,1.32,3.5,3.5Z'/%3E%3Cpolygon class='cls-1' points='182.7 8.31 182.7 13.01 189.7 13.01 189.7 34.85 195.01 34.85 195.01 13.01 202.01 13.01 202.01 8.31 182.7 8.31'/%3E%3Cpath class='cls-1' d='M244.77,8.31h-5.31V34.85h14.67V30.15H244.77Z'/%3E%3Cpath class='cls-1' d='M215.42,8.31h-10V34.85h5.31V26h4.69c5,0,8-2.87,8-8.12v-.42C223.4,12.21,220.65,8.31,215.42,8.31Zm2.73,9.7c0,2.18-1.24,3.5-3.5,3.5h-4V13h4c2.26,0,3.5,1.32,3.5,3.5Z'/%3E%3Cpath class='cls-1' d='M273.42,26.37v-.43c0-5.41-3.12-8.74-8.35-8.74H261c-5.23,0-8.35,3.33-8.35,8.74v.43c0,5.41,3.12,8.74,8.35,8.74h4.07C270.3,35.11,273.42,31.78,273.42,26.37Zm-5.36.2c0,2.44-1.28,4-3.5,4H261c-2.22,0-3.5-1.56-3.5-4v-.63c0-2.44,1.28-4,3.5-4h3.56c2.22,0,3.5,1.56,3.5,4Z'/%3E%3Cpath class='cls-1' d='M90.69,8.31H84.55l-7,26.54h5.58L84.5,30h7.71l1.37,4.84h5.58Zm-5.08,17L88.13,14l2.51,11.26Z'/%3E%3Cpath class='cls-1' d='M17.76,0A17.76,17.76,0,1,0,35.52,17.76,17.76,17.76,0,0,0,17.76,0Zm0,30.81A13.05,13.05,0,1,1,30.81,17.76,13.05,13.05,0,0,1,17.76,30.81Z'/%3E%3Cpath class='cls-1' d='M17.76,9.41A8.35,8.35,0,1,0,26.11,17.76,8.35,8.35,0,0,0,17.76,9.41Z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E" alt="TMDB" class="site-logo">
              </a>
            ` : ''}
            ${movieData && movieData.imdbId ? `
              <a href="https://www.imdb.com/title/${movieData.imdbId}" target="_blank" rel="noopener noreferrer" title="Ver en IMDb">
                <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Cpath fill='%23ffc107' d='M42,6H6C3.8,6,2,7.8,2,10v28c0,2.2,1.8,4,4,4h36c2.2,0,4-1.8,4-4V10C46,7.8,44.2,6,42,6z'/%3E%3Cpath d='M 11 15 L 14 15 L 14 33 L 11 33 Z M 17 15 L 22 15 L 22 20.5 L 22 25 L 22 33 L 19 33 L 19 26 L 19 21.5 L 17 33 L 17 15 Z M 25 15 L 31 15 L 32 25 L 33 15 L 35 15 L 35 33 L 32 33 L 32 20 L 31 33 L 29 33 L 28 20 L 28 33 L 25 33 Z M 36 15 L 41 15 C 42.7 15 44 16.3 44 18 L 44 30 C 44 31.7 42.7 33 41 33 L 36 33 Z M 39 18 L 39 30 L 40 30 C 40.6 30 41 29.6 41 29 L 41 19 C 41 18.4 40.6 18 40 18 Z' fill='%23263238'/%3E%3C/svg%3E" alt="IMDb" class="site-logo">
              </a>
            ` : ''}
            ${movieData && movieData.trailerKey ? `
              <a href="https://www.youtube.com/watch?v=${movieData.trailerKey}" target="_blank" rel="noopener noreferrer" title="Ver trailer">
                <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Cpath fill='%23FF0000' d='M43.2,12.1c-0.5-1.8-1.9-3.2-3.7-3.7C36.2,7.5,24,7.5,24,7.5s-12.2,0-15.5,0.9c-1.8,0.5-3.2,1.9-3.7,3.7C3.9,15.4,3.9,24,3.9,24s0,8.6,0.9,11.9c0.5,1.8,1.9,3.2,3.7,3.7c3.3,0.9,15.5,0.9,15.5,0.9s12.2,0,15.5-0.9c1.8-0.5,3.2-1.9,3.7-3.7C44.1,32.6,44.1,24,44.1,24S44.1,15.4,43.2,12.1z'/%3E%3Cpolygon fill='%23FFF' points='19,31 31,24 19,17'/%3E%3C/svg%3E" alt="YouTube" class="site-logo">
              </a>
            ` : ''}
          </div>
        </div>
        
        <!-- Info del archivo -->
        <div class="file-info">
          <div class="file-name">${fileName}</div>
          ${fileSize ? `<div class="file-size">${fileSize}</div>` : ''}
        </div>
      </div>
      
      <script>
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

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
});
