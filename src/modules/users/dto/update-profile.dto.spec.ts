import { ValidationPipe } from '@nestjs/common';
import { UpdateProfileDto } from './update-profile.dto';

/** Same options as the global pipe in main.ts */
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
  transformOptions: { enableImplicitConversion: true },
});

const validate = (body: Record<string, unknown>) =>
  pipe.transform(body, { type: 'body', metatype: UpdateProfileDto });

describe('UpdateProfileDto avatarUrl', () => {
  it('accepts null to delete the profile picture', async () => {
    const dto = await validate({ avatarUrl: null });
    expect(dto.avatarUrl).toBeNull();
  });

  it('accepts an uploaded photo', async () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/v1/avatar.png';
    const dto = await validate({ avatarUrl: url });
    expect(dto.avatarUrl).toBe(url);
  });

  it('refuses a photo from anywhere else, or an empty one', async () => {
    await expect(validate({ avatarUrl: 'https://example.com/avatar.png' })).rejects.toThrow();
    await expect(validate({ avatarUrl: '' })).rejects.toThrow();
  });
});
