let currentMinQuantity = 0;
let showGibdd = true;
let currentCategory = 'ALL';

ymaps.ready(init);

function init() {
    fetch('open.json')
        .then(response => response.json())
        .then(obj => {
            console.log('raw data:', obj);

            const searchControls = new ymaps.control.SearchControl({
                options: {
                    float: 'right',
                    noPlacemark: true
                }
            });

            const myMap = new ymaps.Map('map', {
                center: [55.76, 37.64],
                zoom: 7,
                controls: [searchControls]
            });

            const removeControls = [
                'geolocationControl',
                'trafficControl',
                'fullscreenControl',
                'zoomControl',
                'rulerControl',
                'typeSelector'
            ];
            removeControls.forEach(ctrl => myMap.controls.remove(ctrl));

            const objectManager = new ymaps.ObjectManager({
                clusterize: true,
                clusterIconLayout: 'default#pieChart'
            });

            let minLatitude = Infinity, maxLatitude = -Infinity;
            let minLongitude = Infinity, maxLongitude = -Infinity;

            let minQuantity = Infinity;
            let maxQuantity = -Infinity;

            const validFeatures = [];
            const categorySet = new Set();

            obj.features.forEach(feature => {
                if (!feature.geometry || !Array.isArray(feature.geometry.coordinates)) {
                    return;
                }

                const [longitude, latitude] = feature.geometry.coordinates;
                const lat = Number(latitude);
                const lon = Number(longitude);

                if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                    return;
                }

                feature.geometry.coordinates = [lat, lon];

                minLatitude = Math.min(minLatitude, lat);
                maxLatitude = Math.max(maxLatitude, lat);
                minLongitude = Math.min(minLongitude, lon);
                maxLongitude = Math.max(maxLongitude, lon);

                const preset = feature.options && feature.options.preset;
                const isBlue = preset === 'islands#blueIcon';

                const q = extractQuantity(feature);
                const category = extractCategory(feature);

                if (!feature.properties) feature.properties = {};
                feature.properties.category = category;

                if (category) {
                    categorySet.add(category);
                }

                if (!isBlue) {
                    if (q === null) {
                        return;
                    }

                    feature.properties.quantity = q;

                    if (q < minQuantity) minQuantity = q;
                    if (q > maxQuantity) maxQuantity = q;
                }

                validFeatures.push(feature);
            });

            if (validFeatures.length === 0) {
                console.warn('Нет точек для отображения.');
                return;
            }

            if (minQuantity === Infinity || maxQuantity === -Infinity) {
                minQuantity = 0;
                maxQuantity = 0;
            }

            obj.features = validFeatures;

            objectManager.removeAll();
            objectManager.add(obj);
            myMap.geoObjects.add(objectManager);

            if (
                minLatitude !== Infinity && maxLatitude !== -Infinity &&
                minLongitude !== Infinity && maxLongitude !== -Infinity
            ) {
                const bounds = [
                    [minLatitude, minLongitude],
                    [maxLatitude, maxLongitude]
                ];
                myMap.setBounds(bounds, { checkZoomRange: true });
            }

            setupFilterUI(
                minQuantity,
                maxQuantity,
                objectManager,
                Array.from(categorySet).sort((a, b) => a.localeCompare(b, 'ru'))
            );
        })
        .catch(err => {
            console.error('Ошибка загрузки open.json:', err);
        });
}

function extractQuantity(feature) {
    if (!feature.properties) return null;

    if (
        feature.properties.quantity !== undefined &&
        feature.properties.quantity !== null &&
        feature.properties.quantity !== ''
    ) {
        const qNum = Number(feature.properties.quantity);
        if (Number.isFinite(qNum)) return qNum;
    }

    const body = feature.properties.balloonContentBody;
    if (typeof body === 'string') {
        const re = /Кол-во\s+ДК\s+за\s+месяц:\s*<span[^>]*>([\d\s]+)/i;
        const match = body.match(re);
        if (match && match[1]) {
            const numStr = match[1].replace(/\s+/g, '');
            const q = parseInt(numStr, 10);
            if (!isNaN(q)) return q;
        }
    }

    return null;
}

function extractCategory(feature) {
    if (!feature.properties) return '';

    if (
        feature.properties.category !== undefined &&
        feature.properties.category !== null
    ) {
        return String(feature.properties.category).trim();
    }

    const body = feature.properties.balloonContentBody;
    if (typeof body === 'string') {
        const re = /Категория:<\/span>\s*([^<]+)/i;
        const match = body.match(re);
        if (match && match[1]) {
            return match[1].trim();
        }
    }

    return '';
}

function setupFilterUI(minQuantity, maxQuantity, objectManager, categories) {
    const toggleBtn = document.getElementById('filter-toggle');
    const gibddToggle = document.getElementById('gibdd-toggle');
    const panel = document.getElementById('filter-panel');
    const range = document.getElementById('quantity-range');
    const input = document.getElementById('quantity-input');
    const currentValueLabel = document.getElementById('filter-current-value');
    const categorySelect = document.getElementById('category-select');

    if (!toggleBtn || !gibddToggle || !panel || !range || !input || !currentValueLabel || !categorySelect) {
        console.warn('Элементы фильтра не найдены в DOM.');
        return;
    }

    panel.style.display = 'none';

    if (minQuantity === maxQuantity) {
        range.min = minQuantity;
        range.max = maxQuantity + 1;
    } else {
        range.min = minQuantity;
        range.max = maxQuantity;
    }

    range.step = 1;
    range.value = minQuantity;

    input.min = minQuantity;
    input.max = maxQuantity;
    input.step = 1;
    input.value = minQuantity;

    currentMinQuantity = minQuantity;
    currentCategory = 'ALL';

    updateCurrentValueLabel(minQuantity);

    categorySelect.innerHTML = '';
    const allOption = document.createElement('option');
    allOption.value = 'ALL';
    allOption.textContent = 'Все категории';
    categorySelect.appendChild(allOption);

    categories.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        categorySelect.appendChild(option);
    });

    toggleBtn.addEventListener('click', () => {
        const visibleNow = panel.style.display === 'block';
        panel.style.display = visibleNow ? 'none' : 'block';
    });

    showGibdd = true;
    gibddToggle.classList.add('active');

    gibddToggle.addEventListener('click', () => {
        showGibdd = !showGibdd;
        gibddToggle.classList.toggle('active', showGibdd);
        applyFilter(currentMinQuantity, currentCategory, objectManager);
    });

    range.addEventListener('input', () => {
        const val = parseInt(range.value, 10);
        input.value = val;
        applyFilter(val, currentCategory, objectManager);
        updateCurrentValueLabel(val);
    });

    input.addEventListener('input', () => {
        let val = parseInt(input.value, 10);
        if (isNaN(val)) val = minQuantity;

        if (val < minQuantity) val = minQuantity;
        if (val > maxQuantity) val = maxQuantity;

        input.value = val;
        range.value = val;
        applyFilter(val, currentCategory, objectManager);
        updateCurrentValueLabel(val);
    });

    categorySelect.addEventListener('change', () => {
        currentCategory = categorySelect.value;
        applyFilter(currentMinQuantity, currentCategory, objectManager);
    });

    function updateCurrentValueLabel(minVal) {
        currentValueLabel.textContent = `Показываются точки с кол-вом ≥ ${minVal}`;
    }

    applyFilter(currentMinQuantity, currentCategory, objectManager);
}

function applyFilter(minQuantity, category, objectManager) {
    currentMinQuantity = minQuantity;
    currentCategory = category;

    if (!objectManager) return;

    objectManager.setFilter(obj => {
        const preset = obj.options && obj.options.preset;
        const isBlue = preset === 'islands#blueIcon';

        if (isBlue) {
            if (!showGibdd) return false;

            if (currentCategory !== 'ALL') {
                const objCategory = extractCategory(obj);
                return objCategory === currentCategory;
            }

            return true;
        }

        const q = extractQuantity(obj);
        if (q === null) return false;
        if (q < currentMinQuantity) return false;

        if (currentCategory !== 'ALL') {
            const objCategory = extractCategory(obj);
            if (objCategory !== currentCategory) return false;
        }

        return true;
    });
}