/*
 * Google-Maps-style smooth scroll zoom for Leaflet.
 *
 * Leaflet's stock scrollWheelZoom is inherently steppy: each wheel event runs a
 * discrete setZoomAround jump, so even with zoomSnap: 0 the map moves in visible
 * hops. This handler does what Google Maps does instead — every wheel event only
 * moves a *goal* zoom, and a requestAnimationFrame loop eases the actual zoom
 * toward that goal each frame (30% of the remaining gap per frame), anchored on
 * the cursor. The result is a continuous glide that keeps up with fast flicks.
 *
 * Adapted from Leaflet.SmoothWheelZoom (MIT, github.com/mutsuyuki).
 *
 * Usage: call enableSmoothWheelZoom(L) once before L.map(...), then create maps
 * with { scrollWheelZoom: false, smoothWheelZoom: true }.
 */
export function enableSmoothWheelZoom(L) {
  if (!L || !L.Map || L.Map.SmoothWheelZoom) return; // already registered

  L.Map.mergeOptions({
    // false | true | 'center' (zoom to view centre instead of the cursor)
    smoothWheelZoom: false,
    // 1 = default speed; higher zooms more per wheel tick.
    smoothSensitivity: 1,
  });

  L.Map.SmoothWheelZoom = L.Handler.extend({
    addHooks: function () {
      L.DomEvent.on(this._map._container, 'wheel', this._onWheelScroll, this);
    },

    removeHooks: function () {
      L.DomEvent.off(this._map._container, 'wheel', this._onWheelScroll, this);
    },

    _onWheelScroll: function (e) {
      if (!this._isWheeling) this._onWheelStart(e);
      this._onWheeling(e);
    },

    _onWheelStart: function (e) {
      const map = this._map;
      this._isWheeling = true;
      this._wheelMousePosition = map.mouseEventToContainerPoint(e);
      this._centerPoint = map.getSize()._divideBy(2);
      this._startLatLng = map.containerPointToLatLng(this._centerPoint);
      this._wheelStartLatLng = map.containerPointToLatLng(this._wheelMousePosition);
      this._moved = false;

      map._stop();
      if (map._panAnim) map._panAnim.stop();

      this._goalZoom = map.getZoom();
      this._prevCenter = map.getCenter();
      this._prevZoom = map.getZoom();

      this._zoomAnimationId = requestAnimationFrame(this._updateWheelZoom.bind(this));
    },

    _onWheeling: function (e) {
      const map = this._map;

      this._goalZoom += L.DomEvent.getWheelDelta(e) * 0.003 * map.options.smoothSensitivity;
      if (this._goalZoom < map.getMinZoom() || this._goalZoom > map.getMaxZoom()) {
        this._goalZoom = map._limitZoom(this._goalZoom);
      }
      this._wheelMousePosition = map.mouseEventToContainerPoint(e);

      clearTimeout(this._timeoutId);
      this._timeoutId = setTimeout(this._onWheelEnd.bind(this), 200);

      L.DomEvent.preventDefault(e);
      L.DomEvent.stopPropagation(e);
    },

    _onWheelEnd: function () {
      this._isWheeling = false;
      cancelAnimationFrame(this._zoomAnimationId);
      // Fire the usual zoomend/moveend so layers (markers, radar, city fetches)
      // refresh exactly once, when the glide settles.
      this._map._moveEnd(true);
    },

    _updateWheelZoom: function () {
      const map = this._map;

      // Something else moved the map (flyTo, a pan) — stop driving it.
      if (!map.getCenter().equals(this._prevCenter) || map.getZoom() !== this._prevZoom) return;

      // Ease 30% of the remaining way each frame.
      let zoom = map.getZoom() + (this._goalZoom - map.getZoom()) * 0.3;
      zoom = Math.floor(zoom * 100) / 100;

      const delta = this._wheelMousePosition.subtract(this._centerPoint);
      const center =
        map.options.smoothWheelZoom === 'center' || (delta.x === 0 && delta.y === 0)
          ? this._startLatLng
          : map.unproject(map.project(this._wheelStartLatLng, zoom).subtract(delta), zoom);

      if (!this._moved) {
        map._moveStart(true, false);
        this._moved = true;
      }

      map._move(center, zoom);
      this._prevCenter = map.getCenter();
      this._prevZoom = map.getZoom();

      this._zoomAnimationId = requestAnimationFrame(this._updateWheelZoom.bind(this));
    },
  });

  L.Map.addInitHook('addHandler', 'smoothWheelZoom', L.Map.SmoothWheelZoom);
}
