import { config } from 'dotenv'
config()
import { DataSource } from 'typeorm'
import ds from '../../config/ormconfig'
import { User } from '../entities/user.entity'
import { hash } from 'bcryptjs'

async function run() {
  const source: DataSource = await ds.initialize()
  const repo = source.getRepository(User)
  
  // Criar admin principal
  const adminEmail = 'admin@clonepages.com'
  const exists = await repo.findOne({ where: { email: adminEmail } })
  
  if (!exists) {
    const password = await hash('Admin@2026', 10)
    const admin = repo.create({ 
      name: 'Administrador', 
      email: adminEmail, 
      password,
      role: 'admin'
    })
    await repo.save(admin)
    console.log('✅ Usuário admin criado:')
    console.log('   Email:', adminEmail)
    console.log('   Senha: Admin@2026')
    console.log('   ⚠️  IMPORTANTE: Altere a senha após o primeiro login!')
  } else {
    console.log('ℹ️  Usuário admin já existe:', adminEmail)
  }
  
  await source.destroy()
}

run().catch(console.error)