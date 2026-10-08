import multer from 'multer';
import {ServiceError} from '../lib/serviceError.js';
import {sha256} from '../middleware/upload.js';
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:3,fields:12,fieldSize:16000}}).array('documents',3);
export function governmentEvidenceUpload(req,res,next) {
  upload(req,res,err=>{
    if(err)return next(new ServiceError(err.code==='LIMIT_FILE_SIZE'?413:400,'Attach at most three PDF, PNG or JPEG files, each no larger than 5 MB.'));
    try {
      req.governmentDocuments=(req.files||[]).map(file=>{
        let type;
        if(file.buffer.subarray(0,5).toString()==='%PDF-')type='application/pdf';
        else if(file.buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))type='image/png';
        else if(file.buffer[0]===255&&file.buffer[1]===216&&file.buffer[2]===255)type='image/jpeg';
        else throw new ServiceError(400,'The file contents must be PDF, PNG or JPEG.');
        return {file_name:file.originalname.replace(/[\x00-\x1f/\\]/g,'_').slice(0,180),content_type:type,byte_size:file.size,sha256:sha256(file.buffer),file_data:file.buffer};
      });
      next();
    }catch(error){next(error);}
  });
}
