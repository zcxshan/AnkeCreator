import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock platform: isCapacitor = true
vi.mock('./platform', () => ({
  isCapacitor: true,
  isElectron: false,
  isWeb: false,
  isMobile: true,
  platformName: 'capacitor',
  capacitorPlatform: 'android',
}));

// Mock settingStore: imageStoreMode = 'local'
vi.mock('../store/settingStore', () => ({
  useSettingStore: {
    getState: () => ({ imageStoreMode: 'local', localUploadEnabled: true }),
  },
}));

// Mock imageWarningStore
vi.mock('../store/imageWarningStore', () => ({
  useImageWarningStore: {
    getState: () => ({ showImageWarning: () => Promise.resolve(true) }),
  },
}));

// Mock LocalImageWarningDialog
vi.mock('../components/common/LocalImageWarningDialog', () => ({
  LOCAL_IMAGE_WARNING_DISMISSED_KEY: 'local_image_warning_dismissed',
}));

// Mock @capacitor/filesystem: writeFile rejects
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    writeFile: vi.fn().mockRejectedValue(new Error('写入失败')),
  },
  Directory: { Documents: 'DOCUMENTS' },
}));

describe('uploadImageFile - Capacitor Filesystem 失败兜底', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Filesystem.writeFile 失败时回退到 base64 data URL 而非 throw', async () => {
    const { uploadImageFile } = await import('./uploadImage');
    const file = new File(['hello'], 'test.png', { type: 'image/png' });
    const result = await uploadImageFile(file);
    expect(result.ok).toBe(true);
    expect(result.url).toMatch(/^data:image\/png;base64,/);
  });
});
