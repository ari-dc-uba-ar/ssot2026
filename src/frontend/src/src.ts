// Main application file
// Code and comments in English

const API_BASE = '/poc';

type TableStructure = {
  columns: Record<string, {type:string}>
  pk: string
  uiName: string
}

const structure = {
  tables: {
    pabellon: {
      columns:{
        pab         : {type:'text'   },
        pabellon    : {type:'text'   },
        pisos       : {type:'integer'},
      },
      pk: 'pab',
      uiName: 'Pabellon'
    },
    materia: {
      columns:{
        cod_mat     :{ type:'text'   },
        materia     :{ type:'text'   },
        plan        :{ type:'number'},
        obligatoria :{ type:'boolean'},
      },
      pk: 'cod_mat',
      uiName: 'Materia'
    }
  }
}

// Type definitions
interface Pabellon {
    pab: string,
    pabellon:  string,
    pisos: number,
}

interface Materia {
    cod_mat: string,
    materia: string,
    plan: string,
    obligatoria: boolean,
}


// DOM elements
const pabellonBtn = document.getElementById('pabellon-btn') as HTMLButtonElement;
const materiaBtn = document.getElementById('materia-btn') as HTMLButtonElement;


const pabellonSection = document.getElementById('pabellon-section') as HTMLElement;
const materiaSection = document.getElementById('materia-section') as HTMLElement;


const addPabellonBtn = document.getElementById('add-pabellon-btn') as HTMLButtonElement;
const addMateriaBtn = document.getElementById('add-materia-btn') as HTMLButtonElement;

const pabellonForm  = document.getElementById('pabellon-form')  as HTMLElement;
const materiaForm   = document.getElementById('materia-form')   as HTMLElement;

const pabellonTable = document.getElementById('pabellon-table') as HTMLTableElement;
const materiaTable  = document.getElementById('materias-table') as HTMLTableElement;

// Navigation
pabellonBtn.addEventListener('click', () => showSection('pabellon'));
materiaBtn.addEventListener('click', () => showSection('materia'));


function showSection(section: string) {
  // Hide all sections
  pabellonSection.classList.remove('active');
  materiaSection.classList.remove('active');

  // Remove active class from buttons
  pabellonBtn.classList.remove('active');
  materiaBtn.classList.remove('active');

  // Show selected section
  switch (section) {
    case 'pabellon':
      pabellonSection.classList.add('active');
      pabellonBtn.classList.add('active');
      loadPabellon();
      break;
    case 'materia':
      materiaSection.classList.add('active');
      materiaBtn.classList.add('active');
      loadMateria();
      break;
  }
}

// Load data functions
async function loadPabellon() {
  try {
    const response = await fetch(`${API_BASE}/lista-pabellones`);
    const pabellones: Pabellon[] = await response.json();
    renderPabellonTable(pabellones);
  } catch (error) {
    console.error('Error cargando pabellones:', error);
  }
}

async function loadMateria() {
  try {
    const response = await fetch(`${API_BASE}/lista-materias`);
    const materias: Materia[] = await response.json();
    renderMateriaTable(materias);
  } catch (error) {
    console.error('Error cargando materias:', error);
  }
}


function renderAnyTable(tableElement: HTMLTableElement, tableStructure: TableStructure, records: Record<string, any>[]){
  const tbody = tableElement.querySelector('tbody')!;
  tbody.innerHTML = '';

  records.forEach(record => {
    const {pk, uiName} = tableStructure;
    const pkValue = encodeURIComponent(record[pk]);
    const row = document.createElement('tr');
    row.innerHTML = 
      Object.entries(tableStructure.columns).map(([name]) => `<td>${record[name] || ''}</td>`).join('')
      +
    `
      <td class="actions">
        <button class="edit-btn" onclick="edit${uiName}('${pkValue}')">Editar / Edit</button>
        <button class="delete-btn" onclick="delete${uiName}('${pkValue}')">Eliminar / Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

// Render table functions
function renderPabellonTable(pabellon: Pabellon[]) {
  return renderAnyTable(pabellonTable, structure.tables.pabellon, pabellon);
}

function renderMateriaTable(materia: Materia[]) {
  return renderAnyTable(materiaTable, structure.tables.materia, materia);
}


// Form functions
addPabellonBtn.addEventListener('click', () => showPabellonForm());
addMateriaBtn.addEventListener('click', () => showMateriaForm());

function showPabellonForm(pabellon?: Pabellon) {
   console.log('Entré a showPabellonForm');
  const isEdit = !!pabellon;
  pabellonForm.innerHTML = `
    <form id="student-form">
      <h3>${isEdit ? 'Editar Pabello' : 'Agregar Pabellon'}</h3>
      <div class="form-group">
        <label for="pab"> Cod pab:</label>
        <input type="text" id="pab" value="${pabellon?.pab || ''}" required>
      </div>
      <div class="form-group">
      <label for="pabellon">Pabellón:</label>
      <select id="pabellon">
          <option value="0+I" ${pabellon?.pabellon === '0+I' ? 'selected' : ''}>0+I</option>
          <option value="1" ${pabellon?.pabellon === '1' ? 'selected' : ''}>1</option>
          <option value="2" ${pabellon?.pabellon === '2' ? 'selected' : ''}>2</option>
        </select>
      </div>
      <div class="form-group">
        <label for="pisos">Pisos:</label>
        <input type="number" id="pisos" value="${pabellon?.pisos || ''}"  min="1" step="1"  required>
      </div>
      <div class="form-actions">
        <button type="submit">${isEdit ? 'Actualizar / Update' : 'Agregar / Add'}</button>
        <button type="button" class="cancel-btn" onclick="hidePabellonForm()">Cancelar / Cancel</button>
      </div>
    </form>
  `;

  pabellonForm.style.display = 'block';

  const form = document.getElementById('student-form') as HTMLFormElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const pabellonData = {
      pab: (document.getElementById('pab') as HTMLInputElement).value,
      pabellon: (document.getElementById('pabellon') as HTMLInputElement).value,
      pisos: (document.getElementById('pisos') as HTMLInputElement).value,
    };

    try {
      if (isEdit) {
        await fetch(`${API_BASE}/actualizar-pabellones`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pabellonData),
        });
      } else {
        await fetch(`${API_BASE}/insertar-pabellones`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pabellonData),
        });
      }
      hidePabellonForm();
      loadPabellon();
    } catch (error) {
      console.error('Errorguardano pabellon:', error);
    }
  });
}

function hidePabellonForm() {
  pabellonForm.style.display = 'none';
}

(window as any).hidePabellonForm = hidePabellonForm;

function showMateriaForm(materia?: Materia) {
  const isEdit = !!materia;
  materiaForm.innerHTML = `
    <form id="subject-form">
      <h3>${isEdit ? 'Editar Materia' : 'Agregar Materia'}</h3>
      <div class="form-group">
        <label for="cod_mat">Código:</label>
        <input type="text" id="cod_mat" value="${materia?.cod_mat || ''}" ${isEdit ? 'readonly' : ''} required>
      </div>
      <div class="form-group">
        <label for="materia">Nombre:</label>
        <input type="text" id="materia" value="${materia?.materia || ''}" required>
      </div>
      <div class="form-group">
        <label for="plan">Plan:</label>
        <input type="text" id="plan" value="${materia?.plan || ''}" required>
      </div>
      <div class="form-group">
        <label for="obligatoria">Obligatoria:</label>
        <input type="boolean" id="obligatoria" value="${materia?.obligatoria || ''}">
      </div>
      <div class="form-actions">
        <button type="submit">${isEdit ? 'Actualizar / Update' : 'Agregar / Add'}</button>
        <button type="button" class="cancel-btn" onclick="hideMateriaForm()">Cancelar / Cancel</button>
      </div>
    </form>
  `;

  materiaForm.style.display = 'block';

  const form = document.getElementById('subject-form') as HTMLFormElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const subjectData = {
      cod_mat: (document.getElementById('cod_mat') as HTMLInputElement).value,
      materia: (document.getElementById('materia') as HTMLInputElement).value,
      plan: (document.getElementById('plan') as HTMLTextAreaElement).value,
      obligatoria: parseInt((document.getElementById('obligatoria') as HTMLInputElement).value),
    };

    try {
      if (isEdit) {
        await fetch(`${API_BASE}/actualizar-materias`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subjectData),
        });
      } else {
        await fetch(`${API_BASE}/insertar-materias`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subjectData),
        });
      }
      hideMateriaForm();
      loadMateria();
    } catch (error) {
      console.error('Error saving subject:', error);
    }
  });
}

function hideMateriaForm() {
  materiaForm.style.display = 'none';
}

(window as any).hideMateriaForm = hideMateriaForm;

// Global functions for onclick
(window as any).editPabellon = async (pab: string) => {
  try {
    const response = await fetch(
    `${API_BASE}/obtener-pabellones/${encodeURIComponent(pab)}`
  );
  if (!response.ok) {
    throw new Error(`Error HTTP: ${response.status}`);
  }
  const pabellon: Pabellon = await response.json();
  showPabellonForm(pabellon);
  } catch (error) {
    console.error('Error cargando materia a editar:', error);
  }
};


(window as any).deletePabellon = async (pab: string) => {
  if (confirm('¿Está seguro de que desea eliminar este pabellon? / Are you sure you want to delete this pabellon?')) {
    try {
      await fetch(`${API_BASE}/eliminar-pabellones/${encodeURIComponent(pab)}`, {method: 'DELETE'});;
      loadPabellon();
    } catch (error) {
      console.error('Error deleting pabellon:', error);
    }
  }
};

(window as any).editMateria = async (cod_mat: string) => {
  try {
    const response = await fetch(
    `${API_BASE}/obtener-materias/${encodeURIComponent(cod_mat)}`
  );

  if (!response.ok) {
    throw new Error(`Error HTTP: ${response.status}`);
  }
  const subject: Materia = await response.json();
  showMateriaForm(subject);
  } catch (error) {
    console.error('Error cargando materia a editar:', error);
  }
};

(window as any).deleteMateria = async (cod_mat: string) => {
  if (confirm('¿Está seguro de que desea eliminar esta materia?')) {
    try {
      await fetch(`${API_BASE}/eliminar-materias/${encodeURIComponent(cod_mat)}`, {method: 'DELETE'});
      loadMateria();
    } catch (error) {
      console.error('Error borrando materia:', error);
    }
  }
};

// Initialize
showSection('pabellon');