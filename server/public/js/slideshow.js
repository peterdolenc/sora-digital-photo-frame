const LAST_SHOWN_KEY = 'photoframe_last_shown';

// "12 March 2019" in the frame's language. Camera times carry no zone and
// a date-time without one is read as local time, so the day never shifts.
function formatTakenAt(takenAt) {
    const date = takenAt ? new Date(takenAt) : null;
    if (!date || isNaN(date)) return '';
    return date.toLocaleDateString(window.i18n?.locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

class PhotoFrameSlideshow {
    constructor() {
        this.currentSlide = 0;
        this.isPlaying = true;
        this.interval = Number(document.documentElement.dataset.interval) || 15000; // DEFAULT_SLIDESHOW_INTERVAL
        this.timer = null;
        this.progressTimer = null;
        this.cursorHideTimer = null;
        this.controlsHideTimer = null;
        this.wakeLock = null;
        this.folderSelector = null;
        this.folderStorage = new FolderStorage();
        this.leavingTimers = [null, null];
        this.currentDuration = this.interval;
        this.noteScheduler = window.NoteScheduler ? new NoteScheduler() : null;
        this.noteHideTimer = null;

        // Ken Burns drift spans the slide plus its crossfade
        document.documentElement.style.setProperty('--slide-duration', `${this.interval + 2000}ms`);

        this.initializeElements();
        this.setupEventListeners();
        this.setupCursorAutoHide();
        this.requestWakeLock();
    }

    initializeElements() {
        this.slides = [
            document.getElementById('slide1'),
            document.getElementById('slide2')
        ];
        this.images = [
            document.getElementById('image1'),
            document.getElementById('image2')
        ];
        this.loadingState = document.getElementById('loadingState');
        this.errorState = document.getElementById('errorState');
        this.errorMessage = document.getElementById('errorMessage');
        this.progressBar = document.getElementById('progressBar');
        this.fullscreenBtn = document.getElementById('fullscreenBtn');
        this.infoBtn = document.getElementById('infoBtn');
        this.infoOverlay = document.getElementById('infoOverlay');
        this.ambients = this.slides.map(slide => slide.querySelector('.slide-ambient'));
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.nextBtn = document.getElementById('nextBtn');
        this.infoCamera = document.getElementById('infoCamera');
        this.infoLens = document.getElementById('infoLens');
        this.infoExposure = document.getElementById('infoExposure');
        this.caption = document.getElementById('photoCaption');
        this.captionPlace = document.getElementById('captionPlace');
        this.captionDate = document.getElementById('captionDate');
        this.captionCaption = document.getElementById('captionCaption');
        this.captionFile = document.getElementById('captionFile');
        this.noteLayer = document.getElementById('noteLayer');

        this.errorState.classList.add('hidden');
        this.images.forEach(img => img.removeAttribute('src'));
    }

    setupEventListeners() {
        this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
        this.infoBtn.addEventListener('click', () => this.toggleInfo());
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.nextBtn.addEventListener('click', () => this.nextImage());

        document.addEventListener('keydown', (e) => {
            // Typing in a field is not a slideshow shortcut
            if (e.target.closest?.('input, textarea, select')) return;
            switch (e.key) {
                case ' ': // Space
                case 'k':
                case 'K':
                    e.preventDefault();
                    this.togglePlayPause();
                    break;
                case 'ArrowRight':
                case 'n':
                case 'N':
                    e.preventDefault();
                    this.nextImage();
                    break;
                case 'f':
                case 'F':
                    e.preventDefault();
                    this.toggleFullscreen();
                    break;
                case 'i':
                case 'I':
                    e.preventDefault();
                    this.toggleInfo();
                    break;
                case 'Escape':
                    if (document.fullscreenElement) {
                        document.exitFullscreen();
                    }
                    break;
            }
        });

        // Mouse and touch events to show controls
        document.addEventListener('mousemove', () => {
            this.showControlsTemporarily();
        });

        document.addEventListener('touchstart', () => {
            this.showControlsTemporarily();
        });

        document.addEventListener('click', () => {
            this.showControlsTemporarily();
        });

        // Handle fullscreen change events
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) {
                document.body.classList.remove('fullscreen');
            }
        });

        document.addEventListener('webkitfullscreenchange', () => {
            if (!document.webkitFullscreenElement) {
                document.body.classList.remove('fullscreen');
            }
        });

        this.images.forEach(img => {
            img.addEventListener('error', () => {
                if (this.errorState.classList.contains('hidden')) {
                    this.showErrorKey('slideshow.loadImageFailed');
                }
            });
        });
    }

    // The next picture for the chosen folder. Ordered folders continue from
    // the last one shown, even after the frame restarts.
    async fetchRandomImage() {
        try {
            const selectedFolderPath = this.folderStorage.getCurrentFolderPath();
            const params = new URLSearchParams();
            if (selectedFolderPath) params.set('folder', selectedFolderPath);
            const last = this.lastShown();
            if (last && last.folder === (selectedFolderPath || '')) params.set('after', last.id);

            const response = await fetch(`/api/images/next?${params}`);
            if (!response.ok) throw new Error(t('slideshow.fetchImageFailed'));
            const data = await response.json();

            if (!data.success) {
                throw new Error(i18n.error(data, 'slideshow.fetchImageFailed'));
            }

            localStorage.setItem(LAST_SHOWN_KEY, JSON.stringify({ folder: selectedFolderPath || '', id: data.image.id }));
            return data.image;
        } catch (error) {
            console.error('Error fetching random image:', error);
            this.showErrorKey('slideshow.loadImageFailedDetail', { detail: error.message });
            return null;
        }
    }

    lastShown() {
        try {
            return JSON.parse(localStorage.getItem(LAST_SHOWN_KEY));
        } catch {
            return null;
        }
    }

    async loadImage(imageData) {
        if (!imageData) return false;

        const src = imageData.url;

        return new Promise((resolve) => {
            const nextSlide = (this.currentSlide + 1) % 2;
            const img = this.images[nextSlide];

            const onLoad = () => {
                img.removeEventListener('load', onLoad);
                img.removeEventListener('error', onError);
                this.hideError();
                this.ambients[nextSlide].style.backgroundImage = `url(${JSON.stringify(src)})`;
                this.currentImageData = imageData;
                resolve(true);
            };

            const onError = (event) => {
                img.removeEventListener('load', onLoad);
                img.removeEventListener('error', onError);
                console.error('Failed to load image:', imageData.url);
                if (this.errorState.classList.contains('hidden')) {
                    this.showErrorKey('slideshow.loadImageFailedDetail', { detail: imageData.filename });
                }
                resolve(false);
            };

            img.addEventListener('load', onLoad);
            img.addEventListener('error', onError);
            img.src = src;
        });
    }

    showImage() {
        const currentSlideEl = this.slides[this.currentSlide];
        const nextSlideEl = this.slides[(this.currentSlide + 1) % 2];

        const leavingIndex = this.currentSlide;
        currentSlideEl.classList.remove('active');
        currentSlideEl.classList.add('leaving');
        clearTimeout(this.leavingTimers[leavingIndex]);
        this.leavingTimers[leavingIndex] = setTimeout(() => {
            currentSlideEl.classList.remove('leaving');
        }, 2000);

        // Restart the drift animation even if this slide was still leaving
        clearTimeout(this.leavingTimers[(leavingIndex + 1) % 2]);
        nextSlideEl.classList.remove('leaving');
        void nextSlideEl.offsetWidth;
        nextSlideEl.classList.add('active');

        this.currentSlide = (this.currentSlide + 1) % 2;
        this.hideNote();
        this.noteScheduler?.photoShown();
        this.updateInfo();
        this.loadingState.classList.add('hidden');
        this.hideError();
    }

    updateInfo() {
        this.updateCaption();
        if (this.currentImageData) {
            const info = this.currentImageData.type === 'image' ? this.currentImageData.info : null;
            this.infoCamera.textContent = info?.camera || '';
            this.infoLens.textContent = info?.lens || '';
            this.infoExposure.textContent = [info?.aperture ? `f/${info.aperture}` : '', info?.iso ? `ISO ${info.iso}` : ''].filter(Boolean).join(' · ');

            // Auto-hide info after 15 seconds if visible
            if (!this.infoOverlay.classList.contains('hidden') && !this.infoTimer) {
                setTimeout(() => {
                    this.infoOverlay.classList.add('hidden');
                }, 15000);
            }
        }
    }

    // "IMG_20240315_family-trip.JPG" -> "IMG family trip"
    convertToFriendlyFileName(filename) {
        return filename
            .replace(/\.[^.]*$/, '')
            .replace(/\d{1,}/g, '')
            .replace(/[_-]/g, ' ')
            .replace(/ {2,}/g, ' ')
            .trim();
    }

    // Where and when the photo was taken, under the photo (Settings can hide it)
    updateCaption() {
        if (!this.caption) return;
        const data = this.currentImageData;
        const info = data?.type === 'image' ? data.info : null;
        const date = formatTakenAt(info?.takenAt);
        const place = info?.place || '';
        const caption = info?.caption || '';
        const filename = this.convertToFriendlyFileName(data?.filename || '');
        const enabled = localStorage.getItem('photoDetailsEnabled') !== 'false';

        this.caption.classList.remove('is-visible');
        clearTimeout(this.captionTimer);
        if (!enabled || !(date || place || caption || filename)) return;

        // Fade the old words out before the new ones come in
        this.captionTimer = setTimeout(() => {
            this.captionPlace.textContent = place;
            this.captionDate.textContent = date;
            this.captionDate.hidden = false;
            this.captionCaption.textContent = caption;
            this.captionFile.textContent = filename;
            this.caption.classList.add('is-visible');
        }, 600);
    }

    async nextImage() {
        this.resetProgress();

        // Every few minutes a note takes the place of the next photo
        const note = this.noteScheduler?.nextDue();
        if (note && await this.showNote(note)) {
            if (this.isPlaying) this.scheduleNext(note.showForSeconds * 1000);
            return;
        }

        const imageData = await this.fetchRandomImage();
        if (imageData) await this.present(imageData);

        if (this.isPlaying) {
            this.scheduleNext();
        }
    }

    // Show the next picture: a photo, or a snap (a saved page) drawn on the note layer
    async present(imageData) {
        if (imageData.type !== 'snap') {
            if (!await this.loadImage(imageData)) return false;
            this.showImage();
            return true;
        }
        if (!await this.showNote(imageData.snap, { scheduled: false })) return false;
        this.currentImageData = imageData;
        this.noteScheduler?.photoShown();
        this.updateInfo();
        this.loadingState.classList.add('hidden');
        this.hideError();
        return true;
    }

    async showNote(note, { scheduled = true } = {}) {
        if (!this.noteLayer || !window.NotePage) return false;
        try {
            const page = NotePage.render(note);
            clearTimeout(this.noteHideTimer);
            this.noteLayer.classList.remove('is-visible');
            this.noteLayer.replaceChildren(page);
            await NotePage.whenLoaded(page);

            void this.noteLayer.offsetWidth; // restart the entrance animation
            this.noteLayer.classList.add('is-visible');
            document.body.classList.add('note-showing');
            if (scheduled) this.noteScheduler.markShown(note);
            return true;
        } catch (error) {
            console.error('Could not show note:', error);
            return false;
        }
    }

    hideNote() {
        if (!this.noteLayer?.classList.contains('is-visible')) return;
        this.noteLayer.classList.remove('is-visible');
        document.body.classList.remove('note-showing');
        clearTimeout(this.noteHideTimer);
        this.noteHideTimer = setTimeout(() => this.noteLayer.replaceChildren(), 1500);
    }

    scheduleNext(duration = this.interval) {
        this.clearTimers();
        this.currentDuration = duration;
        this.timer = setTimeout(() => this.nextImage(), duration);
        this.startProgress(duration);
    }

    startProgress(duration = this.currentDuration) {
        this.progressBar.style.width = '0%';
        let progress = 0;
        const increment = 100 / (duration / 100);

        this.progressTimer = setInterval(() => {
            progress += increment;
            if (progress >= 100) {
                progress = 100;
                clearInterval(this.progressTimer);
            }
            this.progressBar.style.width = progress + '%';
        }, 100);
    }

    resetProgress() {
        this.progressBar.style.width = '0%';
        if (this.progressTimer) {
            clearInterval(this.progressTimer);
            this.progressTimer = null;
        }
    }

    clearTimers() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.progressTimer) {
            clearInterval(this.progressTimer);
            this.progressTimer = null;
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            // Enter fullscreen
            const element = document.documentElement;

            if (element.requestFullscreen) {
                element.requestFullscreen().then(() => {
                    document.body.classList.add('fullscreen');
                    this.showControlsTemporarily();
                }).catch((err) => {
                    console.error('Error attempting to enable fullscreen:', err);
                });
            } else if (element.webkitRequestFullscreen) {
                element.webkitRequestFullscreen();
                document.body.classList.add('fullscreen');
                this.showControlsTemporarily();
            } else if (element.msRequestFullscreen) {
                element.msRequestFullscreen();
                document.body.classList.add('fullscreen');
                this.showControlsTemporarily();
            }
        } else {
            // Exit fullscreen
            if (document.exitFullscreen) {
                document.exitFullscreen().then(() => {
                    document.body.classList.remove('fullscreen');
                }).catch((err) => {
                    console.error('Error attempting to exit fullscreen:', err);
                });
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
                document.body.classList.remove('fullscreen');
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
                document.body.classList.remove('fullscreen');
            }
        }
    }

    // The server asked for the info overlay: show it for a while, whatever photos come
    showInfoFor(seconds) {
        clearTimeout(this.infoTimer);
        this.infoOverlay.classList.remove('hidden');
        this.infoTimer = setTimeout(() => {
            this.infoTimer = null;
            this.infoOverlay.classList.add('hidden');
        }, seconds * 1000);
    }

    // Starts the slideshow and then follows the server's commands
    async start() {
        this.hideError();
        this.initializeFolderSelector();
        try {
            // Folders load first, so the slideshow starts on a folder that exists
            await this.folderSelector.refresh();
            await this.startSlideshow();
        } catch (error) {
            console.error('Failed to initialize slideshow:', error);
            this.showErrorKey('slideshow.loadFoldersFailed');
        }
        this.listenToServer();
    }

    // The server controls the frame through an event stream (see services/frameService)
    // The browser reconnects by itself; on every connection the server tells the current account.
    listenToServer() {
        const events = new EventSource('/api/frame/events');
        const parse = event => {
            try {
                return JSON.parse(event.data);
            } catch {
                return {};
            }
        };
        events.addEventListener('next', () => this.nextImage());
        events.addEventListener('info', event => this.showInfoFor(Number(parse(event).seconds) || 5));
        const account = event => this.onAccountState(parse(event));
        events.addEventListener('state', account);
        events.addEventListener('account', account);
    }

    // A different account shows different folders: start over with what it may see
    async onAccountState({ accountId }) {
        const changed = this.accountId !== undefined && this.accountId !== accountId;
        this.accountId = accountId;
        if (!changed) return;
        await this.folderSelector.refresh(); // falls back to all folders if the chosen one is out of reach
        await this.onFolderChanged(this.folderStorage.getCurrentFolderPath(), '');
    }

    toggleInfo() {
        this.infoOverlay.classList.toggle('hidden');
    }

    togglePlayPause() {
        this.isPlaying = !this.isPlaying;
        document.body.classList.toggle('is-paused', !this.isPlaying);
        this.renderPlayPause();

        if (this.isPlaying) {
            // Resume slideshow (a note keeps its own, longer duration)
            this.scheduleNext(this.currentDuration);
        } else {
            // Pause slideshow
            this.clearTimers();
            this.resetProgress();
        }
    }

    // Icon, label and tooltip follow the play state (and the language)
    renderPlayPause() {
        this.playPauseBtn.querySelector('.material-icons').textContent = this.isPlaying ? 'pause' : 'play_arrow';
        this.playPauseBtn.setAttribute('aria-label', this.isPlaying ? t('slideshow.static_009') : t('slideshow.resume'));
        this.playPauseBtn.title = this.isPlaying ? t('slideshow.static_010') : t('slideshow.playTitle');
    }

    // Re-draws the text this class sets itself, in the current language
    renderLanguage() {
        this.renderPlayPause();
        if (this.errorText && !this.errorState.classList.contains('hidden')) this.errorMessage.textContent = t(...this.errorText);
    }

    showControlsTemporarily() {
        // Clear any existing hide timer
        if (this.controlsHideTimer) {
            clearTimeout(this.controlsHideTimer);
        }

        document.body.classList.add('chrome-visible');

        // Hide controls after 3 seconds of inactivity
        this.controlsHideTimer = setTimeout(() => {
            document.body.classList.remove('chrome-visible');
        }, 3000);
    }

    showError(message) {
        this.errorText = null;
        this.errorMessage.removeAttribute('data-i18n'); // the message is set here from now on
        this.errorMessage.textContent = message;
        this.errorState.classList.remove('hidden');
        this.loadingState.classList.add('hidden');
    }

    // Same, but kept as a key so it follows a language change
    showErrorKey(key, vars) {
        this.showError(t(key, vars));
        this.errorText = [key, vars];
    }

    hideError() {
        this.errorState.classList.add('hidden');
    }

    requestWakeLock() {
        // Keep phones and tablets awake for as long as the frame is open
        if (!this.wakeLock) this.wakeLock = new KeepAwake();
        this.wakeLock.enable();
    }

    setupCursorAutoHide() {
        const hideCursor = () => {
            document.body.classList.add('hide-cursor');
        };

        const showCursor = () => {
            document.body.classList.remove('hide-cursor');
            clearTimeout(this.cursorHideTimer);
            this.cursorHideTimer = setTimeout(hideCursor, 3000);
        };

        document.addEventListener('mousemove', showCursor);
        document.addEventListener('mousedown', showCursor);
        document.addEventListener('keydown', showCursor);

        this.cursorHideTimer = setTimeout(hideCursor, 3000);
    }

    initializeFolderSelector() {
        const container = document.getElementById('folderSelector');
        if (container && window.FolderSelector) {
            this.folderSelector = new FolderSelector(container, {
                onFolderChanged: (folderPath, folderName) => {
                    this.onFolderChanged(folderPath, folderName);
                },
                showFolderCount: true,
                autoClose: true
            });

            this.folderSelector.folders = [];
            this.folderSelector.renderFolders();
        }
    }

    async onFolderChanged(folderPath, folderName) {
        this.clearTimers();
        this.resetProgress();

        const imageData = await this.fetchRandomImage();
        if (imageData) {
            const loaded = await this.present(imageData);
            if (loaded) {
                this.scheduleNext();
            } else {
                this.showErrorKey('slideshow.loadFolderImageFailed');
            }
        } else {
            if (folderName) this.showErrorKey('slideshow.noImagesInFolder', { folder: folderName });
            else this.showErrorKey('slideshow.noImagesInAllFolders');
        }
    }

    cleanup() {
        this.clearTimers();

        if (this.cursorHideTimer) {
            clearTimeout(this.cursorHideTimer);
            this.cursorHideTimer = null;
        }

        if (this.controlsHideTimer) {
            clearTimeout(this.controlsHideTimer);
            this.controlsHideTimer = null;
        }

        if (this.wakeLock) {
            this.wakeLock.disable();
        }

        this.noteScheduler?.stop();
    }

    async startSlideshow() {
        this.hideError();
        this.noteScheduler?.start();

        const imageData = await this.fetchRandomImage();
        if (imageData) {
            const loaded = await this.present(imageData);
            if (loaded) {
                this.scheduleNext();
            } else {
                this.showErrorKey('slideshow.loadFirstImageFailed');
            }
        } else {
            this.showErrorKey('slideshow.noImages');
        }
    }
}

// Weather and Clock Widget
class WeatherWidget {
    constructor() {
        this.timeDisplay = document.getElementById('timeDisplay');
        this.dateDisplay = document.getElementById('dateDisplay');
        this.weatherIcon = document.getElementById('weatherIcon');
        this.tempDisplay = document.getElementById('tempDisplay');
        this.widget = document.getElementById('weatherWidget');

        this.lat = null;
        this.lon = null;
        this.weatherData = null;
        this.updateInterval = null;
        this.weatherInterval = null;

        this.checkAndInit();
    }

    checkAndInit() {
        // Check if weather widget is enabled (default: off)
        const enabled = localStorage.getItem('weatherWidgetEnabled') === 'true';

        if (enabled) {
            this.show();
            this.init();
        } else {
            this.hide();
        }

        // Update date display visibility
        this.updateDateVisibility();

        // Update widget opacity
        this.updateOpacity();

        // Listen for changes in localStorage
        window.addEventListener('storage', (e) => {
            if (e.key === 'weatherWidgetEnabled') {
                const isEnabled = e.newValue === 'true';
                if (isEnabled) {
                    this.show();
                    if (!this.updateInterval) this.init();
                } else {
                    this.hide();
                }
            }
            // Update temperature display when unit changes
            if (e.key === 'temperatureUnit' && this.weatherData) {
                this.updateTemperatureDisplay();
            }
            // Update date display when toggled
            if (e.key === 'dateDisplayEnabled') {
                this.updateDateVisibility();
            }
            // Update time display when format changes
            if (e.key === 'timeFormat') {
                this.updateTime();
            }
            // Update widget opacity when changed
            if (e.key === 'widgetOpacity') {
                this.updateOpacity();
            }
        });
    }

    show() {
        if (this.widget) this.widget.style.display = '';
    }

    hide() {
        if (this.widget) this.widget.style.display = 'none';
        this.cleanup();
    }

    updateDateVisibility() {
        const enabled = localStorage.getItem('dateDisplayEnabled') !== 'false';
        if (this.dateDisplay) {
            this.dateDisplay.style.display = enabled ? 'block' : 'none';
        }
    }

    updateOpacity() {
        const opacity = parseInt(localStorage.getItem('widgetOpacity') || '100');
        const root = document.documentElement.style;
        // Opacity drives the legibility scrim behind the clock...
        root.setProperty('--widget-alpha', opacity / 100);
        // ...and the text sits 20% more opaque than it (capped at 100%)
        root.setProperty('--widget-text', Math.min(opacity + 20, 100) / 100);
    }

    cleanup() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        if (this.weatherInterval) {
            clearInterval(this.weatherInterval);
            this.weatherInterval = null;
        }
    }

    async init() {
        this.updateTime();
        this.updateInterval = setInterval(() => this.updateTime(), 1000);

        await this.getLocation();
        await this.updateWeather();

        // Update weather every 10 minutes
        this.weatherInterval = setInterval(() => this.updateWeather(), 10 * 60 * 1000);
    }

    updateTime() {
        const now = new Date();
        const format = localStorage.getItem('timeFormat') || '24';

        let timeStr;
        if (format === '12') {
            let hours = now.getHours();
            // AM/PM in the page language ("PM" in English)
            const ampm = new Intl.DateTimeFormat(window.i18n?.locale, { hour: 'numeric', hour12: true })
                .formatToParts(now).find(part => part.type === 'dayPeriod')?.value || (hours >= 12 ? 'PM' : 'AM');
            hours = hours % 12;
            hours = hours ? hours : 12; // 0 should be 12
            const minutes = now.getMinutes().toString().padStart(2, '0');
            timeStr = `${hours}:${minutes}<span class="ampm">${ampm}</span>`;
        } else {
            const hours = now.getHours().toString().padStart(2, '0');
            const minutes = now.getMinutes().toString().padStart(2, '0');
            timeStr = `${hours}:${minutes}`;
        }

        this.timeDisplay.innerHTML = timeStr;

        // Update date (e.g., "Mon, Jan 1")
        const options = { weekday: 'short', month: 'short', day: 'numeric' };
        const dateStr = now.toLocaleDateString(window.i18n?.locale, options);
        this.dateDisplay.textContent = dateStr;
    }

    async getLocation() {
        try {
            // Use ipapi.co for simple IP geolocation (no API key needed)
            const response = await fetch('https://ipapi.co/json/');
            const data = await response.json();

            if (data.latitude && data.longitude) {
                this.lat = data.latitude;
                this.lon = data.longitude;
            }
        } catch (error) {
            console.error('Failed to get location:', error);
        }
    }

    async updateWeather() {
        if (!this.lat || !this.lon) return;

        try {
            this.widget.classList.add('loading');

            // Use Open-Meteo API (free, no API key required)
            const response = await fetch(
                `https://api.open-meteo.com/v1/forecast?latitude=${this.lat}&longitude=${this.lon}&current=temperature_2m,weather_code&timezone=auto`
            );
            const data = await response.json();

            if (data.current) {
                this.weatherData = data.current;
                const weatherCode = data.current.weather_code;

                this.updateTemperatureDisplay();
                this.weatherIcon.textContent = this.getWeatherEmoji(weatherCode);
            }
        } catch (error) {
            console.error('Failed to fetch weather:', error);
        } finally {
            this.widget.classList.remove('loading');
        }
    }

    updateTemperatureDisplay() {
        if (!this.weatherData) return;

        const tempC = Math.round(this.weatherData.temperature_2m);
        const unit = localStorage.getItem('temperatureUnit') || 'C';

        if (unit === 'F') {
            const tempF = Math.round((tempC * 9/5) + 32);
            this.tempDisplay.textContent = `${tempF}°F`;
        } else {
            this.tempDisplay.textContent = `${tempC}°C`;
        }
    }

    getWeatherEmoji(code) {
        // WMO Weather interpretation codes - using Material Icons
        if (code === 0) return 'wb_sunny'; // Clear sky
        if (code <= 3) return 'partly_cloudy_day'; // Partly cloudy
        if (code <= 48) return 'foggy'; // Fog
        if (code <= 57) return 'water_drop'; // Drizzle
        if (code <= 67) return 'rainy'; // Rain
        if (code <= 77) return 'ac_unit'; // Snow
        if (code <= 82) return 'rainy'; // Rain showers
        if (code <= 86) return 'weather_snowy'; // Snow showers
        if (code <= 99) return 'thunderstorm'; // Thunderstorm
        return 'cloud'; // Default
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.slideshow = new PhotoFrameSlideshow();
    window.weatherWidget = new WeatherWidget();
    window.addEventListener('sora:languagechange', () => {
        window.weatherWidget.updateTime();
        window.slideshow.renderLanguage();
    });

    // The server plays one account and starts the frame at once: no sign-in
    window.slideshow.start();

    window.addEventListener('beforeunload', () => {
        window.slideshow.cleanup();
    });
});
