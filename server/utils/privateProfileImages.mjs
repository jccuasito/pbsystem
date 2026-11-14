import path from 'node:path'

export function privateProfileDirectory(kind) {
  if (!['employees', 'avatars'].includes(kind)) throw new Error('Invalid profile image category.')
  return path.resolve(process.env.PROFILE_IMAGE_STORAGE_DIR || path.join(process.cwd(), '.data', 'profile-images'), kind)
}

export function privateProfilePath(kind, name) {
  if (typeof name !== 'string' || !/^(?:employee-)?[1-9]\d*-[a-f0-9]{12}\.(png|jpg|webp)$/.test(name)) throw new Error('Invalid profile image filename.')
  return path.join(privateProfileDirectory(kind), name)
}
