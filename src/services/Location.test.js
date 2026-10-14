import { getDevicePosition } from './Location';

const pos = (lat, lon, acc = 20) => ({ coords: { latitude: lat, longitude: lon, accuracy: acc } });

describe('getDevicePosition', () => {
  const realGeo = navigator.geolocation;
  const realSecure = window.isSecureContext;
  let calls;

  const mockGeo = (...outcomes) => {
    calls = [];
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok, err, opts) => {
          calls.push(opts);
          const next = outcomes.shift();
          if (next.coords) ok(next);
          else err(next);
        },
      },
    });
  };

  beforeEach(() => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  });

  afterAll(() => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: realGeo });
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: realSecure });
  });

  it('returns a high-accuracy fix when it arrives', async () => {
    mockGeo(pos(-6.2, 106.8, 12));
    await expect(getDevicePosition()).resolves.toEqual({ lat: -6.2, lon: 106.8, acc: 12 });
    expect(calls).toHaveLength(1);
    expect(calls[0].enableHighAccuracy).toBe(true);
  });

  it('falls back to a coarse fix when GPS times out (common on iPhone indoors)', async () => {
    mockGeo({ code: 3 }, pos(-6.3, 106.9, 900));
    await expect(getDevicePosition()).resolves.toEqual({ lat: -6.3, lon: 106.9, acc: 900 });
    expect(calls).toHaveLength(2);
    expect(calls[1].enableHighAccuracy).toBe(false);
  });

  it('does not retry when permission is denied, and says where to fix it', async () => {
    mockGeo({ code: 1 });
    await expect(getDevicePosition()).rejects.toMatchObject({ code: 'denied' });
    expect(calls).toHaveLength(1);
  });

  it('refuses up front on an insecure origin (http on a LAN address)', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    mockGeo(pos(0, 0));
    await expect(getDevicePosition()).rejects.toMatchObject({ code: 'insecure' });
    expect(calls).toHaveLength(0);
  });

  it('reports a timeout when both attempts fail', async () => {
    mockGeo({ code: 3 }, { code: 3 });
    await expect(getDevicePosition()).rejects.toMatchObject({ code: 'timeout' });
  });
});
