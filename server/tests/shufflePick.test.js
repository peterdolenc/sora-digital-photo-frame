// Mock the ordering so pickShuffled can be tested on its own
jest.mock('../services/playOrderService', () => ({
  // Photos are named by their date rank, so oldest first is by id
  sort: jest.fn(async (dir, items) => [...items].sort((a, b) => a.id.localeCompare(b.id)))
}));

const controller = require('../controllers/imageController');

const photos = n => Array.from({ length: n }, (_, i) => ({ id: `p${String(i).padStart(2, '0')}` }));
const take = async (images, count, dir = 'dir') => {
  const ids = [];
  for (let i = 0; i < count; i++) ids.push((await controller.pickShuffled(images, dir)).id);
  return ids;
};

describe('pickShuffled', () => {
  beforeEach(() => {
    controller.recentlyShown = new Set();
    controller.shuffleQueue = { key: null, items: [] };
    controller.shufflePickAmount = 3;
    jest.spyOn(Math, 'random');
  });
  afterEach(() => jest.restoreAllMocks());

  test('plays a run of consecutive photos oldest first, then picks again', async () => {
    const images = photos(20);
    Math.random.mockReturnValueOnce(0.25).mockReturnValueOnce(0.5); // starts at 5, then the 9th of the 17 not just shown (11)
    expect(await take(images, 6)).toEqual(['p05', 'p06', 'p07', 'p11', 'p12', 'p13']);
  });

  test('a run near the end is shorter', async () => {
    Math.random.mockReturnValueOnce(0.95).mockReturnValueOnce(0); // starts at 19, then 0
    expect(await take(photos(20), 2)).toEqual(['p19', 'p00']);
  });

  test('starts again when the folder changes', async () => {
    Math.random.mockReturnValue(0);
    expect(await take(photos(20), 1)).toEqual(['p00']);
    expect(await take(photos(5), 2, 'other')).toEqual(['p00', 'p01']);
  });

  test('starts again when a photo is deleted', async () => {
    const images = photos(20);
    Math.random.mockReturnValue(0);
    expect(await take(images, 1)).toEqual(['p00']);
    expect(await take(images.filter(img => img.id === 'p00' || img.id > 'p01'), 2)).toEqual(['p02', 'p03']);
  });

  test('does not start a run on a recently shown photo', async () => {
    const images = photos(20);
    Math.random.mockReturnValue(0);
    expect(await take(images, 6)).toEqual(['p00', 'p01', 'p02', 'p03', 'p04', 'p05']);
  });
});
