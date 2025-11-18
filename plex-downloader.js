(function () {
    if (window.__plex_dl_loaded__) return;
    window.__plex_dl_loaded__ = true;

    async function getXML(url) {
        const res = await fetch(url);
        const text = await res.text();
        return new DOMParser().parseFromString(text, "application/xml");
    }

    function getClientId() {
        const m = /server\/([a-f0-9]{40})\//.exec(location.href);
        return m ? m[1] : null;
    }

    function getMetadataId() {
        const m1 = /key=%2Flibrary%2Fmetadata%2F(\d+)/.exec(location.href);
        const m2 = /\/details\/(\d+)/.exec(location.href);
        const m3 = /\/item\/(\d+)/.exec(location.href);
        return (m1 && m1[1]) || (m2 && m2[1]) || (m3 && m3[1]) || null;
    }

    async function getServerAccess(serverToken, clientId) {
        const url = `https://plex.tv/api/resources?includeHttps=1&X-Plex-Token=${serverToken}`;
        const xml = await getXML(url);

        const accessToken = xml.evaluate(
            `//Device[@clientIdentifier='${clientId}']/@accessToken`,
            xml,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
        ).singleNodeValue?.textContent;

        const baseUri = xml.evaluate(
            `//Device[@clientIdentifier='${clientId}']/Connection[@local=0]/@uri`,
            xml,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
        ).singleNodeValue?.textContent;

        return { accessToken, baseUri };
    }

    async function getParts(baseUri, token, metadataId) {
        const url = `${baseUri}/library/metadata/${metadataId}?X-Plex-Token=${token}`;
        const xml = await getXML(url);

        const nodes = xml.evaluate(
            "//Media/Part/@key",
            xml,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null
        );

        const arr = [];
        for (let i = 0; i < nodes.snapshotLength; i++) {
            arr.push(nodes.snapshotItem(i).textContent);
        }
        return arr;
    }

    function download(baseUri, partKey, token) {
        const url = `${baseUri}${partKey}?download=1&X-Plex-Token=${token}`;
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    function findButtonContainer() {
        return (
            document.querySelector('button[aria-label="Play"], button[aria-label="Reproducir"]')
                ?.parentElement ||
            document.querySelector(".details") ||
            document.querySelector("header") ||
            document.body
        );
    }

    function createDownloadButton() {
        const btn = document.createElement("button");
        btn.textContent = "Descargar";
        Object.assign(btn.style, {
            background: "#e5a00d",
            color: "#111",
            border: "none",
            padding: "10px 18px",
            borderRadius: "6px",
            fontSize: "16px",
            fontWeight: "bold",
            marginLeft: "10px",
            cursor: "pointer"
        });
        return btn;
    }

    async function startDownload() {
        try {
            const token = localStorage.myPlexAccessToken;
            if (!token) return alert("No se encontró myPlexAccessToken. Inicia sesión en Plex Web.");

            const clientId = getClientId();
            if (!clientId) return alert("No se pudo obtener clientID.");

            const { accessToken, baseUri } = await getServerAccess(token, clientId);
            if (!accessToken || !baseUri)
                return alert("No se pudo obtener accessToken o baseUri del servidor.");

            let metaId = getMetadataId();

            if (!metaId) return alert("No se pudo detectar qué estás viendo (episodio/serie/etc).");

            const parts = await getParts(baseUri, accessToken, metaId);
            if (!parts.length) return alert("No se encontraron partes descargables.");

            for (let p of parts) download(baseUri, p, accessToken);

            alert("Descarga iniciada.");
        } catch (e) {
            alert("Error: " + e.message);
            console.error(e);
        }
    }

    const container = findButtonContainer();
    const btn = createDownloadButton();
    btn.onclick = startDownload;

    try {
        container.appendChild(btn);
    } catch {
        document.body.appendChild(btn);
    }

    console.log("Plex Downloader inyectado.");
})();
