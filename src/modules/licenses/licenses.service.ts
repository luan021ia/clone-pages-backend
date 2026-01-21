import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { License } from '../../database/entities/license.entity'

@Injectable()
export class LicensesService {
  constructor(
    @InjectRepository(License)
    private readonly licenseRepo: Repository<License>
  ) {}

  async createLicense(userId: string, days: number): Promise<License> {
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + days)

    const license = this.licenseRepo.create({
      userId,
      isActive: true,
      expiresAt
    })

    return this.licenseRepo.save(license)
  }

  async getUserLicense(userId: string): Promise<License | null> {
    return this.licenseRepo.findOne({ where: { userId } })
  }

  async renewLicense(userId: string, days: number): Promise<License> {
    let license = await this.getUserLicense(userId)

    if (!license) {
      // Create new license if doesn't exist
      return this.createLicense(userId, days)
    }

    // RENOVAR = Adicionar dias à licença ATIVA existente
    // Se a licença está ativa e não expirou, soma os dias
    // Se expirou ou está inativa, cria nova data a partir de AGORA
    const now = new Date()
    let baseDate = now
    
    if (license.isActive && license.expiresAt > now) {
      // Licença ativa: adiciona dias à data de expiração atual
      baseDate = license.expiresAt
    }
    
    const newExpiry = new Date(baseDate)
    newExpiry.setDate(newExpiry.getDate() + days)

    license.expiresAt = newExpiry
    license.isActive = true

    return this.licenseRepo.save(license)
  }

  async deactivateLicense(userId: string): Promise<License> {
    const license = await this.getUserLicense(userId)
    if (!license) throw new Error('License not found')

    // DESATIVAR = Marca como inativa E zera a data de expiração
    license.isActive = false
    license.expiresAt = new Date() // Data atual = expirado

    return this.licenseRepo.save(license)
  }

  async reactivateLicense(userId: string, days: number): Promise<License> {
    let license = await this.getUserLicense(userId)

    if (!license) {
      // Não existe licença: cria nova
      return this.createLicense(userId, days)
    }

    // REATIVAR = NOVA licença do ZERO (ignora data antiga)
    const newExpiry = new Date()
    newExpiry.setDate(newExpiry.getDate() + days)

    license.isActive = true
    license.expiresAt = newExpiry // Nova data a partir de AGORA

    return this.licenseRepo.save(license)
  }

  async setLicenseDays(userId: string, days: number): Promise<License> {
    let license = await this.getUserLicense(userId)

    if (!license) {
      // Não existe licença: cria nova
      return this.createLicense(userId, days)
    }

    // DEFINIR DIAS = Define data de expiração a partir de AGORA com quantidade específica de dias
    const newExpiry = new Date()
    newExpiry.setDate(newExpiry.getDate() + days)

    license.expiresAt = newExpiry
    // Ativa a licença automaticamente se dias > 0
    license.isActive = days > 0

    return this.licenseRepo.save(license)
  }

  getLicenseInfo(license: License | null) {
    if (!license) {
      return {
        isActive: false,
        status: 'inactive',
        expiresAt: null,
        daysRemaining: 0
      }
    }

    const now = new Date()
    const expiresAt = new Date(license.expiresAt)
    const diffMs = expiresAt.getTime() - now.getTime()
    const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

    let status = 'active'
    if (!license.isActive) {
      status = 'inactive'
    } else if (daysRemaining <= 0) {
      status = 'expired'
    } else if (daysRemaining <= 7) {
      status = 'expiring_soon'
    }

    return {
      isActive: license.isActive && daysRemaining > 0,
      status,
      expiresAt: license.expiresAt.toISOString(),
      daysRemaining: Math.max(0, daysRemaining)
    }
  }
}

