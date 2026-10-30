import { extractPrice, formatNaira } from './price';

describe('extractPrice', () => {
  it.each([
    ['iPhone 13, 128GB, UK used, ₦450,000', 450_000],
    ['iPhone 13 128gb N450k', 450_000],
    ['MacBook Pro M2 NGN 1.2m', 1_200_000],
    ['PS5 slim 650000 naira', 650_000],
    ['PS5 slim 650,000naira', 650_000],
    ['AirPods Pro 2, price: 9000', 9_000],
    ['Galaxy S23 Ultra 256gb going for 780k', 780_000],
    ['Pixel 7 pro 1.1 million', 1_100_000],
    ['Tecno Camon 20 185000', 185_000],
    ['Sony 4K TV 55 inch 350k', 350_000],
    ['Earbuds ₦5,500', 5_500],
  ])('reads the price in "%s"', (text, expected) => {
    expect(extractPrice(text)).toBe(expected);
  });

  it.each([
    'iPhone 13, 128GB, UK used',
    'MacBook Pro 2019 16GB RAM 512GB SSD',
    'Sony 4K TV 55 inch',
    'Samsung A12345 5000mAh',
    'iPhone 13 call 08012345678',
    'Galaxy Note 10 plus',
    'Earbuds 5500',
  ])('finds no price in "%s"', (text) => {
    expect(extractPrice(text)).toBeNull();
  });
});

describe('formatNaira', () => {
  it('groups thousands', () => {
    expect(formatNaira(1_200_000)).toBe('₦1,200,000');
  });
});
