import { Body, Controller, Delete, Get, Param, Post, Put, Headers, BadRequestException, UnauthorizedException, UseGuards, Request } from '@nestjs/common';
import { UsersService } from '../services/users.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { LoginDto } from '../dto/login.dto';
import { JwtService } from '@nestjs/jwt';
import { LicensesService } from '../../licenses/licenses.service';
import { randomUUID } from 'crypto';
import { SessionGuard } from '../../../common/guards/session.guard';

@Controller('users')
export class UsersController {
  constructor(
    private readonly service: UsersService, 
    private readonly jwt: JwtService,
    private readonly licensesService: LicensesService
  ) {}

  @Post()
  async create(@Body() data: CreateUserDto) {
    const user = await this.service.create(data)
    
    // Criar licença automaticamente se licenseDays foi fornecido
    if (data.licenseDays && user.role !== 'admin') {
      await this.licensesService.createLicense(user.id, data.licenseDays)
    }
    
    return user
  }

  @Put(':id')
  @UseGuards(SessionGuard)
  update(@Param('id') id: string, @Body() data: UpdateUserDto) {
    return this.service.update(id, data)
  }

  @Delete(':id')
  @UseGuards(SessionGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id)
  }

  @Get(':id')
  @UseGuards(SessionGuard)
  getById(@Param('id') id: string) {
    return this.service.getById(id)
  }

  @Post('login')
  async login(@Body() data: LoginDto) {
    console.log('🔐 [Login] Iniciando login para:', data.email);
    const user = await this.service.validate(data.email, data.password)
    if (!user) throw new UnauthorizedException('Credenciais inválidas')

    console.log('✅ [Login] Credenciais válidas. userId:', user.id);

    // Gerar sessionId único para esta sessão
    const sessionId = randomUUID()
    console.log('🔑 [Login] SessionId gerado:', sessionId);

    // Salvar sessionId no banco (invalida sessões anteriores automaticamente)
    console.log('💾 [Login] Salvando sessionId no banco...');
    await this.service.updateSessionId(user.id, sessionId)
    console.log('✅ [Login] SessionId salvo no banco');

    // Admins têm acesso ilimitado
    if (user.role === 'admin') {
      console.log('👑 [Login] Admin detectado. Gerando token...');
      // ✅ INCLUIR EMAIL NO TOKEN para permitir fallback no frontend
      const token = await this.jwt.signAsync({ 
        sub: user.id, 
        email: user.email,  // ✅ NOVO: incluir email
        name: user.name,    // ✅ NOVO: incluir name
        role: user.role, 
        sessionId 
      })
      console.log('✅ [Login] Token gerado para admin. SessionId incluído:', sessionId);
      return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } }
    }

    // Usuários normais: verificar licença
    console.log('👤 [Login] Usuário normal. Verificando licença...');
    const license = await this.licensesService.getUserLicense(user.id)
    const licenseInfo = this.licensesService.getLicenseInfo(license)

    if (!licenseInfo.isActive) {
      console.error('❌ [Login] Licença inativa ou expirada');
      throw new UnauthorizedException('Sua licença está inativa ou expirada. Entre em contato com o suporte.')
    }

    console.log('✅ [Login] Licença ativa. Gerando token...');
    // ✅ INCLUIR EMAIL NO TOKEN para permitir fallback no frontend
    const token = await this.jwt.signAsync({ 
      sub: user.id, 
      email: user.email,  // ✅ NOVO: incluir email
      name: user.name,    // ✅ NOVO: incluir name
      role: user.role, 
      sessionId 
    })
    console.log('✅ [Login] Token gerado. SessionId incluído:', sessionId);
    return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } }
  }

  @Get('me')
  @UseGuards(SessionGuard)
  async getCurrentUser(@Request() req: any) {
    const userId = req.user.id;
    const user = await this.service.getById(userId);
    return { user: { id: user.id, name: user.name, email: user.email, role: user.role, cpf: user.cpf, phone: user.phone } };
  }

  // Admin routes
  @Get()
  @UseGuards(SessionGuard)
  async getAllUsers() {
    return this.service.getAll()
  }

  @Put(':id/password')
  @UseGuards(SessionGuard)
  async updatePassword(@Param('id') id: string, @Body() data: { password: string }) {
    if (!data.password || data.password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters')
    }
    return this.service.updatePassword(id, data.password)
  }

  @Get(':id/license')
  @UseGuards(SessionGuard)
  async getUserLicense(@Param('id') id: string) {
    const license = await this.licensesService.getUserLicense(id)
    return this.licensesService.getLicenseInfo(license)
  }

  @Put(':id/license')
  @UseGuards(SessionGuard)
  async renewLicense(@Param('id') id: string, @Body() data: { days: number }) {
    const license = await this.licensesService.renewLicense(id, data.days)
    return this.licensesService.getLicenseInfo(license)
  }

  @Post(':id/license/deactivate')
  @UseGuards(SessionGuard)
  async deactivateLicense(@Param('id') id: string) {
    const license = await this.licensesService.deactivateLicense(id)
    return this.licensesService.getLicenseInfo(license)
  }

  @Post(':id/license/reactivate')
  @UseGuards(SessionGuard)
  async reactivateLicense(@Param('id') id: string, @Body() data: { days: number }) {
    const license = await this.licensesService.reactivateLicense(id, data.days)
    return this.licensesService.getLicenseInfo(license)
  }

  @Put(':id/license/days')
  @UseGuards(SessionGuard)
  async setLicenseDays(@Param('id') id: string, @Body() data: { days: number }) {
    const license = await this.licensesService.setLicenseDays(id, data.days)
    return this.licensesService.getLicenseInfo(license)
  }
}