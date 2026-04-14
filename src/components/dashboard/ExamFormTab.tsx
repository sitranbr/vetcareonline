import {
  PlusCircle,
  AlertCircle,
  Users,
  Tag,
  Link as LinkIcon,
  Plus,
  X,
  DollarSign,
  Save,
  Loader2,
} from 'lucide-react';
import { formatMoney } from '../../utils/calculations';
import { canManageTeamAccess } from '../../lib/teamPermissions';
import type { Modality, Period, MachineOwner } from '../../types';
import type { ExamItem } from '../../types';
import type { DashboardData } from '../../hooks/useDashboardData';

export function ExamFormTab(props: DashboardData) {
  return (
          <div className="p-6 max-w-4xl mx-auto">
            <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <PlusCircle className="w-6 h-6 text-petcare-DEFAULT" />
              {props.editingExamId ? 'Editar Exame' : 'Novo Exame'}
            </h2>

            {props.examSaveError && (
              <div
                role="alert"
                className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 animate-fade-in"
              >
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-red-800 text-sm">Erro ao salvar o exame</h3>
                  <p className="text-sm text-red-900 mt-2 whitespace-pre-wrap break-words">{props.examSaveError}</p>
                  <button
                    type="button"
                    onClick={() => props.setExamSaveError(null)}
                    className="mt-3 text-xs font-semibold text-red-700 hover:text-red-900 underline"
                  >
                    Dispensar
                  </button>
                </div>
              </div>
            )}

            {props.loggedUserEntity?.type === 'clinic' && props.availableVeterinarians.length === 0 && (
              <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 animate-fade-in">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-amber-800 text-sm">Nenhum veterinário encontrado</h3>
                  <p className="text-sm text-amber-700 mt-1">
                    {canManageTeamAccess(props.user)
                      ? 'Você precisa cadastrar sua equipe ou vincular veterinários parceiros antes de lançar exames.'
                      : 'Solicite ao administrador da clínica que cadastre veterinários ou vincule parceiros antes de lançar exames.'}
                  </p>
                  {canManageTeamAccess(props.user) && (
                    <button 
                      type="button"
                      onClick={() => props.navigate('/users')}
                      className="mt-2 text-xs font-bold bg-amber-100 text-amber-800 px-3 py-1.5 rounded-lg hover:bg-amber-200 transition-colors flex items-center gap-1"
                    >
                      <Users className="w-3 h-3" /> Ir para Minha Equipe
                    </button>
                  )}
                </div>
              </div>
            )}

            {props.loggedUserEntity?.type === 'vet' && props.availableClinicsForVet.length === 0 && !props.isIndependentVetSubscriber && (
              <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 animate-fade-in">
                <LinkIcon className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-amber-800 text-sm">Nenhuma clínica vinculada</h3>
                  <p className="text-sm text-amber-700 mt-1">
                    Para lançar exames, você precisa estar vinculado a uma clínica parceira. Solicite o vínculo à clínica.
                  </p>
                </div>
              </div>
            )}

            {!props.editingExamId && props.isIndependentVetSubscriber && !props.vetHasAtLeastOnePricedRule && (
              <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 animate-fade-in">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-bold text-amber-800 text-sm">Cadastre preços antes dos exames</h3>
                  <p className="text-sm text-amber-800 mt-1">
                    Antes de cadastrar um exame, é necessário definir o preço de pelo menos um tipo de exame na Tabela de Preços.
                  </p>
                  <button
                    type="button"
                    onClick={() => props.setActiveTab('prices')}
                    className="mt-3 text-xs font-bold bg-amber-100 text-amber-900 px-3 py-2 rounded-lg hover:bg-amber-200 transition-colors inline-flex items-center gap-1"
                  >
                    <Tag className="w-3.5 h-3.5" /> Abrir Tabela de Preços
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={props.handleSaveExam} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Data do Exame</label>
                  <input type="date" required value={props.formData.date} onChange={e => props.setFormData({...props.formData, date: e.target.value})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Paciente (PET)</label>
                  <input type="text" required value={props.formData.petName} onChange={e => props.setFormData({...props.formData, petName: e.target.value})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT" placeholder="Nome do animal" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Espécie</label>
                  <select value={props.formData.species} onChange={e => props.setFormData({...props.formData, species: e.target.value})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT">
                    {props.SPECIES_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                  {props.formData.species === 'Outros' && (
                    <input type="text" placeholder="Qual espécie?" value={props.formData.customSpecies} onChange={e => props.setFormData({...props.formData, customSpecies: e.target.value})} className="mt-2 w-full px-3 py-2 border rounded-lg text-sm" />
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Veterinário Requisitante (Externo)</label>
                  <input type="text" value={props.formData.requesterVet} onChange={e => props.setFormData({...props.formData, requesterVet: e.target.value})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT" placeholder="Quem pediu o exame?" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">CRMV do Requisitante</label>
                  <input type="text" value={props.formData.requesterCrmv} onChange={e => props.setFormData({...props.formData, requesterCrmv: e.target.value})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT" placeholder="Opcional" />
                </div>

                {props.loggedUserEntity?.type === 'vet' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Clínica (Local do Exame){props.isIndependentVetSubscriber ? <span className="text-gray-400 font-normal"> — opcional</span> : null}
                    </label>
                    {props.availableClinicsForVet.length > 0 ? (
                      <select
                        required={!props.isIndependentVetSubscriber}
                        value={props.formData.clinicId}
                        onChange={e => props.setFormData({ ...props.formData, clinicId: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT"
                      >
                        <option value="">{props.isIndependentVetSubscriber ? 'Sem clínica (atendimento independente)' : 'Selecione a Clínica'}</option>
                        {props.availableClinicsForVet.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : props.isIndependentVetSubscriber ? (
                      <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                        Atendimento independente: você pode lançar exames sem vincular uma clínica. A clínica permanece opcional se você passar a atender parceiros depois.
                      </p>
                    ) : (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                          <div>
                            <p className="font-medium">Nenhuma clínica vinculada.</p>
                            <p className="text-xs text-amber-700 mt-1">
                              Para lançar exames, você precisa estar vinculado a uma clínica parceira. Solicite o vínculo à clínica.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Veterinário Responsável (Executor)</label>
                    <select required value={props.formData.veterinarianId} onChange={e => props.setFormData({...props.formData, veterinarianId: e.target.value})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT">
                      <option value="">Selecione o Veterinário</option>
                      {props.availableVeterinarians.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </div>
                )}
              </div>

              <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                <h3 className="font-bold text-gray-700 mb-3 text-sm uppercase tracking-wide">Configuração de Cobrança</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">Período</label>
                    <select 
                      value={props.formData.period} 
                      onChange={e => props.setFormData({...props.formData, period: e.target.value as Period})} 
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      {props.availablePeriods.map(p => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">Proprietário da Máquina</label>
                    <select value={props.formData.machineOwner} onChange={e => props.setFormData({...props.formData, machineOwner: e.target.value as MachineOwner})} className="w-full px-3 py-2 border rounded-lg">
                      <option value="professional">Profissional (Volante)</option>
                      <option value="clinic">Clínica (Fixa)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-gray-700">Exames Realizados</h3>
                  {!props.editingExamId && (
                    <button 
                      type="button" 
                      onClick={props.addItem}
                      className="text-sm font-bold text-petcare-dark hover:text-petcare-DEFAULT flex items-center gap-1 transition-colors"
                    >
                      <Plus className="w-4 h-4" /> Adicionar outro exame
                    </button>
                  )}
                </div>

                <div className="space-y-4">
                  {props.formData.items.map((item, index) => {
                    const selectValue = item.modality === 'OUTROS'
                      ? (props.availableExamsForSelectedClinic.some(opt => opt.value === `OUTROS|${item.studyDescription || ''}`)
                          ? `OUTROS|${item.studyDescription || ''}`
                          : '')
                      : item.modality;

                    return (
                    <div key={item.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm relative group">
                      {props.formData.items.length > 1 && !props.editingExamId && (
                        <button 
                          type="button" 
                          onClick={() => props.removeItem(item.id)}
                          className="absolute top-2 right-2 text-gray-300 hover:text-red-500 p-1 transition-colors"
                          title="Remover este exame"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                      
                      <p className="text-xs font-bold text-gray-400 mb-2">Modalidade {index + 1}</p>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-1">Exame</label>
                          <select 
                            required 
                            value={selectValue} 
                            onChange={e => {
                              const val = e.target.value;
                              if (val.startsWith('OUTROS|')) {
                                const customName = val.substring(7);
                                props.updateItem(item.id, 'modality', 'OUTROS');
                                props.updateItem(item.id, 'studyDescription', customName);
                              } else {
                                props.updateItem(item.id, 'modality', val as Modality);
                                props.updateItem(item.id, 'studyDescription', '');
                              }
                            }} 
                            className="w-full px-3 py-2 border rounded-lg bg-gray-50 focus:bg-white transition-colors"
                          >
                            <option value="">Selecione...</option>
                            {props.availableExamsForSelectedClinic.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                        
                        {(item.modality === 'RX' || item.modality === 'RX_FAST') && (
                          <div className="animate-fade-in">
                            <label className="block text-xs font-bold text-gray-500 mb-1">Nº de Estudos/Projeções</label>
                            <input 
                              type="number" 
                              min="1" 
                              value={item.studies} 
                              onChange={e => props.updateItem(item.id, 'studies', parseInt(e.target.value) || 1)} 
                              className="w-full px-3 py-2 border rounded-lg"
                            />
                          </div>
                        )}

                        {item.modality !== 'OUTROS' && (
                          <div className={item.modality === 'RX' || item.modality === 'RX_FAST' ? '' : 'md:col-span-2'}>
                            <label className="block text-xs font-bold text-gray-500 mb-1">Descrição / Região (Opcional)</label>
                            <input 
                              type="text" 
                              value={item.studyDescription || ''} 
                              onChange={e => props.updateItem(item.id, 'studyDescription', e.target.value)} 
                              className="w-full px-3 py-2 border rounded-lg"
                              placeholder="Ex: Abdominal, Tórax, Membro..."
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )})}
                </div>
              </div>

              <div className="bg-petcare-light/10 border border-petcare-light/20 rounded-xl p-6 animate-fade-in">
                <div className="flex items-center gap-2 mb-4">
                  <DollarSign className="w-5 h-5 text-petcare-dark" />
                  <h3 className="font-bold text-petcare-dark">Prévia Total (Todos os exames)</h3>
                </div>

                <div className="flex flex-col md:flex-row items-center gap-4">
                  <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 flex-1 w-full">
                    <p className="text-xs text-gray-500 mb-1">Valor Total</p>
                    <p className="text-xl font-bold text-gray-800">{formatMoney(props.previewTotals.total)}</p>
                  </div>
                  <div className="hidden md:flex items-center justify-center text-gray-400 font-bold text-2xl">-</div>
                  <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 flex-1 w-full">
                    <p className="text-xs text-gray-500 mb-1">Líquido Profissional</p>
                    <p className="text-xl font-bold text-gray-800">{formatMoney(props.previewTotals.prof)}</p>
                  </div>
                  <div className="hidden md:flex items-center justify-center text-gray-400 font-bold text-2xl">=</div>
                  <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 flex-1 w-full">
                    <p className="text-xs text-gray-500 mb-1">Líquido Clínica</p>
                    <p className="text-xl font-bold text-gray-800">{formatMoney(props.previewTotals.clinic)}</p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  type="submit"
                  disabled={
                    props.isSavingExam ||
                    (!props.editingExamId && props.isIndependentVetSubscriber && !props.vetHasAtLeastOnePricedRule)
                  }
                  className="bg-petcare-dark text-white px-8 py-3 rounded-lg font-bold hover:bg-petcare-DEFAULT transition-all shadow-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {props.isSavingExam ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  {props.editingExamId ? 'Atualizar Exame' : 'Salvar Exames'}
                </button>
              </div>
            </form>
          </div>
  );
}
